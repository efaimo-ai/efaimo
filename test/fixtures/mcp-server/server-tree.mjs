// A stdio server that never answers, started through server-tree.cmd.
//
// That is the shape of an npx server on Windows: the process efaimo spawns is a
// cmd.exe wrapper and the real server is the wrapper's child. Ending only the
// wrapper leaves this process running, and the pipes it inherited keep the
// auditing process alive. Appends its pid to the file named by argv[2] so a
// test can see whether it survived.
import fs from "node:fs";

fs.appendFileSync(process.argv[2], `${process.pid}\n`);
setInterval(() => {}, 1000);
