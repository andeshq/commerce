// Loaded before every test file (see bunfig.toml). tsyringe needs the Reflect
// metadata polyfill to be present before any decorated class is imported.
import "reflect-metadata";

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// testcontainers needs a reachable Docker socket. On macOS with colima the
// default `/var/run/docker.sock` doesn't exist, so point it at the colima
// socket when DOCKER_HOST isn't already set. CI and plain Docker are untouched.
if (!process.env.DOCKER_HOST) {
  const socket = join(homedir(), ".colima", "default", "docker.sock");
  if (existsSync(socket)) {
    process.env.DOCKER_HOST = `unix://${socket}`;
    process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE ??= "/var/run/docker.sock";
  }
}
