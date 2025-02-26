process.env.NODE_ENV = "test"

import * as dotenv from "dotenv"
import * as path from "path"

const root = path.resolve().split("/")
root.pop()
dotenv.config({ path: path.resolve(root.join("/") + "/.env") })
