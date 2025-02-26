process.env.NODE_ENV = "test"

import * as dotenv from "dotenv"
import * as path from "path"

const root = path.resolve().split("/")
root.pop()
console.log("path: ", root.join("/"))

dotenv.config({ path: path.resolve(root.join("/") + "/.env") })
