import dotenv from "dotenv"
import * as path from "node:path"
dotenv.config({ path: path.resolve(process.cwd(), "../../.env.local") })

export const version = "0.1.0"

export { IntentFiller } from "./core/filler"
export { EventMonitor } from "./core/event-monitor"
export { BasicFiller } from "./strategies/basic"
export { ConfirmationPolicy } from "./config/confirmation-policy"
