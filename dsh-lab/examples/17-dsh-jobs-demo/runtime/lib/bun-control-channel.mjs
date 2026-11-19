/**
 * bun-control-channel.mjs —— Bun/Windows 下 PTC worker 控制通道的降级实现。
 *
 * 上游 openInheritedControlChannel() 用 `new Socket({ fd: 7 })` 接管 runner
 * 继承的匿名管道。Node 的 libuv 在 Windows 上会把继承句柄映射成 fd 并支持
 * 匿名管道；Bun 1.4.4 两者都不做——fd 7 是 EBADF，Socket({fd}) 对任何继承
 * 句柄都抛 "Unsupported fd type: UNKNOWN"。但句柄本身确实传进了进程（对照
 * 实验：GetFileType 能在句柄空间里扫到 FILE_TYPE_PIPE）。
 *
 * 所以这里绕开 fd 层：扫句柄空间找到继承的管道（worker 只继承这一根管道，
 * stdout/stderr 走 std 句柄），用 koffi 直调 ReadFile/WriteFile 包成 Duplex。
 * 读用 overlapped + 事件 + 5ms 轮询（不阻塞事件循环），写用同步 WriteFile
 * （宿主持续排水，控制帧都很小）。协议层（birpc JSON 行）完全不用改。
 *
 * 代价与边界：
 *   - 只在 Bun + win32 下被 preload 注入；Node 路径原样走上游 Socket。
 *   - 句柄扫描假设 worker 恰好继承一根管道；多于一根就大声报错，不猜。
 *   - 依赖 koffi（dsh-win32-process 的既有依赖，node_modules 里已有）。
 *
 * @module dsh-jobs-demo/runtime/lib/bun-control-channel
 */
import { Duplex } from 'node:stream'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** 打开继承的控制管道，返回字节模式 Duplex（语义对齐上游 Socket 用法）。 */
export function openBunControlChannel() {
  if (process.platform !== 'win32') throw new Error('bun-control-channel shim 只支持 win32')
  const koffi = require('koffi')
  const kernel32 = koffi.load('kernel32.dll')
  const GetFileType = kernel32.func('uint32_t __stdcall GetFileType(void* h)')
  const PeekNamedPipe = kernel32.func('int __stdcall PeekNamedPipe(void* h, void* buf, uint32_t n, uint32_t* read, uint32_t* avail, uint32_t* left)')
  const ReadFile = kernel32.func('int __stdcall ReadFile(void* h, void* buf, uint32_t n, uint32_t* read, void* overlapped)')
  const WriteFile = kernel32.func('int __stdcall WriteFile(void* h, const void* buf, uint32_t n, uint32_t* written, void* overlapped)')
  const CreateEventW = kernel32.func('void* __stdcall CreateEventW(void* sa, int manual, int initial, void* name)')
  const WaitForSingleObject = kernel32.func('uint32_t __stdcall WaitForSingleObject(void* h, uint32_t ms)')
  const GetOverlappedResult = kernel32.func('int __stdcall GetOverlappedResult(void* h, void* ov, uint32_t* transferred, int wait)')
  const CloseHandle = kernel32.func('int __stdcall CloseHandle(void* h)')
  const GetLastError = kernel32.func('uint32_t __stdcall GetLastError()')
  const GetStdHandle = kernel32.func('void* __stdcall GetStdHandle(uint32_t which)')

  const FILE_TYPE_PIPE = 3
  const ERROR_BROKEN_PIPE = 109
  const ERROR_HANDLE_EOF = 38
  const WAIT_OBJECT_0 = 0

  // 句柄值是 4 的倍数；4096 覆盖常见进程句柄表规模。worker 的 stdout/stderr
  // 也是管道，先记下 std 句柄值，扫描时排除——只留控制通道那一根。
  const stdHandles = new Set([0xFFFFFFF6, 0xFFFFFFF5, 0xFFFFFFF4].map(which => Number(koffi.address(GetStdHandle(which)))))
  const avail = koffi.alloc('uint32_t', 1)
  const candidates = []
  for (let h = 4; h <= 4096; h += 4) {
    if (stdHandles.has(h)) continue
    if (GetFileType(h) !== FILE_TYPE_PIPE) continue
    // GetFileType 对某些非管道对象也可能误报；PeekNamedPipe 成功才算管道。
    if (PeekNamedPipe(h, null, 0, null, avail, null) !== 0) candidates.push(h)
  }
  if (candidates.length !== 1) {
    throw new Error(`bun-control-channel: 期望恰好 1 根继承管道，实际 ${candidates.length} 根（${candidates.join(', ')}）`)
  }
  const pipe = candidates[0]

  const event = CreateEventW(null, 1, 0, null) // manual-reset
  if (event === null || event === 0) throw new Error(`bun-control-channel: CreateEventW 失败（${GetLastError()}）`)
  const readBuf = Buffer.alloc(65536)
  const transferred = koffi.alloc('uint32_t', 1)
  // OVERLAPPED：hEvent 在偏移 24（x64：Internal 8 + InternalHigh 8 + Offset/OffsetHigh 8）。
  const overlapped = Buffer.alloc(32)
  overlapped.writeBigUInt64LE(BigInt(koffi.address(event)), 24)

  let reading = false
  let destroyed = false
  const stream = new Duplex({
    read() { armRead() },
    write(chunk, _enc, cb) {
      try {
        let offset = 0
        while (offset < chunk.length) {
          const ok = WriteFile(pipe, chunk.subarray(offset), chunk.length - offset, transferred, null)
          const n = koffi.decode(transferred, 'uint32_t')
          if (ok === 0) throw new Error(`WriteFile 失败（${GetLastError()}）`)
          if (n === 0) throw new Error('WriteFile 写入 0 字节')
          offset += n
        }
        cb()
      } catch (error) { cb(error) }
    },
    destroy(error, cb) {
      destroyed = true
      CloseHandle(event)
      CloseHandle(pipe)
      cb(error)
    },
  })

  function armRead() {
    if (reading || destroyed) return
    reading = true
    const ok = ReadFile(pipe, readBuf, readBuf.length, transferred, overlapped)
    if (ok !== 0) { deliver(koffi.decode(transferred, 'uint32_t')); return }
    const err = GetLastError()
    if (err !== 997 /* ERROR_IO_PENDING */) { finishRead(err); return }
    const timer = setInterval(() => {
      if (destroyed) { clearInterval(timer); return }
      if (WaitForSingleObject(event, 0) !== WAIT_OBJECT_0) return
      clearInterval(timer)
      const got = GetOverlappedResult(pipe, overlapped, transferred, 0)
      if (got === 0) { finishRead(GetLastError()); return }
      deliver(koffi.decode(transferred, 'uint32_t'))
    }, 5)
  }

  function deliver(n) {
    reading = false
    if (destroyed) return
    if (n === 0) { stream.push(null); return }
    const more = stream.push(Buffer.from(readBuf.subarray(0, n)))
    if (more) armRead()
  }

  function finishRead(err) {
    reading = false
    if (destroyed) return
    if (err === ERROR_BROKEN_PIPE || err === ERROR_HANDLE_EOF) { stream.push(null); return }
    stream.destroy(new Error(`bun-control-channel: ReadFile 失败（${err}）`))
  }

  armRead()
  return stream
}