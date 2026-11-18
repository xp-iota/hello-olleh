/** runner 与各插件共享的观测记录：apply 计数、effect 顺序、闹钟触发。 */
export const counters = { applies: 0 }
export const order: string[] = []
export const fired: string[] = []