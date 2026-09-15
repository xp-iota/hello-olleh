import { createHarness } from '../../runtime/harness.ts'
import UserQuestionService from '../impl/03-user-questions.ts'

const harness = await createHarness()
await harness.loadPlugin(UserQuestionService)
harness.ctx.on('user-questions/request', request => Promise.resolve({
  answers: request.questions.map(question => ({ id: question.id, selected: ['继续'] })),
}))
const answer = await harness.ctx.userQuestions.ask({
  agent: harness.agent,
  questions: [{ id: 'confirm', question: '继续执行离线教学阶段？', options: [{ label: '继续' }, { label: '停止' }] }],
})
console.log('userQuestions:', answer)
await harness.dispose()
