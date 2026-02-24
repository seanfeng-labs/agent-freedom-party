import { run } from './runner'
// @ts-ignore
import config from '../config'

run(config).catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
