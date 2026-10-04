import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { root, run } from "./common.mjs";
import { command } from "./process.mjs";

async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
/** Create only new local, disposable services; no external relay URL or database accepted. */
export async function relayFixture() {
  if (process.platform === "win32")
    throw new Error(
      "Run real-relay compatibility on Linux/macOS with local Docker",
    );
  const endpoint =
    process.env.DOCKER_HOST ||
    JSON.parse(run("docker", ["context", "inspect"]))[0].Endpoints.docker.Host;
  if (!endpoint.startsWith("unix://"))
    throw new Error("Only a local Unix Docker endpoint is allowed");
  // Always build current source: an arbitrary existing image/binary is not compatibility evidence.
  await command(
    "cargo",
    ["build", "--locked", "--profile", "ci", "-p", "buzz-relay"],
    { cwd: root, timeout: 50 * 60_000 },
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kovar-relay-"));
  const prefix = `kovar-test-${randomUUID()}`;
  const created = [];
  const ownerKey = generateSecretKey();
  let child;
  let log = "";
  let logExceeded = false;
  async function close() {
    const errors = [];
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 8000);
      await exited;
      clearTimeout(killTimer);
    }
    for (const name of created.reverse()) {
      try {
        run("docker", ["rm", "-f", name]);
      } catch {
        errors.push(name);
      }
    }
    ownerKey.fill(0);
    fs.rmSync(directory, { recursive: true, force: true });
    if (errors.length)
      throw new Error(
        `Could not remove owned test containers: ${errors.join(", ")}`,
      );
  }
  try {
    for (const [suffix, image, exposed, extra] of [
      [
        "pg",
        "postgres:17-alpine",
        "5432",
        [
          "-e",
          "POSTGRES_PASSWORD=fixture-only",
          "-e",
          "POSTGRES_USER=buzz",
          "-e",
          "POSTGRES_DB=buzz",
          "--tmpfs",
          "/var/lib/postgresql/data",
        ],
      ],
      ["redis", "redis:7-alpine", "6379", []],
      [
        "s3",
        "ghcr.io/block/buzz-minio@sha256:b8470bbeafbf57b20c86cf63804682b714bdcfdbb517f3770247e321e623f48f",
        "9000",
        [
          "-e",
          "MINIO_ROOT_USER=fixture",
          "-e",
          "MINIO_ROOT_PASSWORD=fixture-secret-password",
          "--tmpfs",
          "/data",
        ],
      ],
    ]) {
      const name = `${prefix}-${suffix}`;
      run("docker", [
        "run",
        "-d",
        "--rm",
        "--name",
        name,
        "--memory",
        "512m",
        "--pids-limit",
        "128",
        "-p",
        `127.0.0.1::${exposed}`,
        ...extra,
        ...(suffix === "s3" ? ["--platform", "linux/amd64"] : []),
        image,
        ...(suffix === "s3" ? ["server", "/data"] : []),
      ]);
      created.push(name);
    }
    const dockerPort = (suffix, exposed) =>
      Number(
        run("docker", ["port", `${prefix}-${suffix}`, exposed])
          .split(":")
          .at(-1),
      );
    let pgReady = false;
    for (let i = 0; i < 60; i++) {
      try {
        run("docker", ["exec", `${prefix}-pg`, "pg_isready", "-U", "buzz"]);
        pgReady = true;
        break;
      } catch {
        await delay(500);
      }
    }
    if (!pgReady) throw new Error("Disposable PostgreSQL did not start");
    const s3 = `http://127.0.0.1:${dockerPort("s3", "9000")}`;
    let s3Ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        if (
          (
            await fetch(`${s3}/minio/health/live`, {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        ) {
          s3Ready = true;
          break;
        }
      } catch {
        /* bounded startup retry */
      }
      await delay(500);
    }
    if (!s3Ready) throw new Error("Disposable MinIO did not start");
    run("docker", [
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--network",
      `container:${prefix}-s3`,
      "--entrypoint",
      "/bin/sh",
      "ghcr.io/block/buzz-minio@sha256:b8470bbeafbf57b20c86cf63804682b714bdcfdbb517f3770247e321e623f48f",
      "-c",
      "mc alias set local http://127.0.0.1:9000 fixture fixture-secret-password && mc mb local/buzz-media",
    ]);
    const main = await port();
    const health = await port();
    const metrics = await port();
    const origin = `http://127.0.0.1:${main}`;
    const env = {
      PATH: process.env.PATH,
      HOME: directory,
      RUST_LOG: "error",
      BUZZ_S3_ENDPOINT: s3,
      BUZZ_S3_ACCESS_KEY: "fixture",
      BUZZ_S3_SECRET_KEY: "fixture-secret-password",
      BUZZ_S3_BUCKET: "buzz-media",
      DATABASE_URL: `postgres://buzz:fixture-only@127.0.0.1:${dockerPort("pg", "5432")}/buzz`,
      REDIS_URL: `redis://127.0.0.1:${dockerPort("redis", "6379")}`,
      RELAY_URL: origin.replace("http:", "ws:"),
      BUZZ_BIND_ADDR: `127.0.0.1:${main}`,
      BUZZ_HEALTH_PORT: String(health),
      BUZZ_METRICS_PORT: String(metrics),
      BUZZ_RELAY_PRIVATE_KEY: Buffer.from(generateSecretKey()).toString("hex"),
      RELAY_OWNER_PUBKEY: getPublicKey(ownerKey),
      BUZZ_REQUIRE_AUTH_TOKEN: "true",
      BUZZ_REQUIRE_RELAY_MEMBERSHIP: "true",
      BUZZ_AUTO_MIGRATE: "true",
      BUZZ_RECONCILE_CHANNELS: "true",
    };
    child = spawn(path.join(root, "target/ci/buzz-relay"), [], {
      cwd: directory,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let spawnError;
    child.on("error", (error) => {
      spawnError = error;
    });
    const capture = (data) => {
      log += data;
      if (log.length > 1024 * 1024) {
        log = log.slice(-8192);
        logExceeded = true;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    for (let i = 0; i < 120; i++) {
      if (spawnError) throw spawnError;
      if (logExceeded || child.exitCode !== null)
        throw new Error(`Isolated relay exited: ${log.slice(-8000)}`);
      try {
        const result = await fetch(`http://127.0.0.1:${health}/_readiness`, {
          signal: AbortSignal.timeout(1000),
        });
        if (result.ok) return { origin, directory, ownerKey, close };
      } catch {
        /* Retry readiness only, with a bounded deadline. */
      }
      await delay(500);
    }
    throw new Error(`Isolated relay readiness timeout: ${log.slice(-8000)}`);
  } catch (error) {
    await close();
    throw error;
  }
}
