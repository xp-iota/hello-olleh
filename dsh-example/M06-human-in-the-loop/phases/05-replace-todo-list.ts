import { createHarness } from '../../runtime/harness.ts'
import * as todo from '../steps/05-todo.ts'

const harness = await createHarness({ plugins: [[todo, { allowParallelInProgress: false }]] })
const result = await harness.callTool('todo_write', {
  todos: [
    { content: '核对服务', status: 'completed' },
    { content: '运行门禁', status: 'in_progress' },
  ],
})
console.log('todo:', { isError: result.isError, projection: harness.ctx.sessionProjections.stateOf(harness.agent.session, 'todos') })
await harness.dispose()
