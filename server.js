const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs/promises");
const { existsSync, createReadStream } = require("fs");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const { fileHeader, toJson, toMarkdown } = require("@ohah/hwpjs");
const packageInfo = require("./package.json");

const {
  extractProfileFromMarkdown,
  analyzeTemplateMarkdown,
  buildDraftValues,
} = require("./src/extractors");

const ROOT = __dirname;
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5177);
const DATA_ROOT = process.env.HWP_AUTOFILL_DATA_DIR || ROOT;
const UPLOAD_DIR = path.join(DATA_ROOT, "uploads");
const OUTPUT_DIR = path.join(DATA_ROOT, "outputs");
const WORK_DIR = path.join(DATA_ROOT, ".work");
const DATA_DIR = path.join(DATA_ROOT, "data");
const BUNDLED_HWP_WORKER = path.join(ROOT, "bin", "hwp_worker.exe");
const HWP_WORKER_SCRIPT = path.join(ROOT, "scripts", "hwp_worker.py");

const app = express();

async function ensureDirs() {
  await Promise.all([
    fs.mkdir(UPLOAD_DIR, { recursive: true }),
    fs.mkdir(OUTPUT_DIR, { recursive: true }),
    fs.mkdir(WORK_DIR, { recursive: true }),
    fs.mkdir(DATA_DIR, { recursive: true }),
  ]);
}

function safeBaseName(name) {
  const parsed = path.parse(name || "document.hwp");
  return `${parsed.name}`.replace(/[^\w가-힣()[\]\-. ]+/g, "_").slice(0, 90) || "document";
}

function decodeOriginalName(name) {
  const raw = name || "";
  if (/[가-힣]/.test(raw)) return raw;
  return Buffer.from(raw, "latin1").toString("utf8");
}

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await ensureDirs();
      cb(null, UPLOAD_DIR);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const id = randomUUID();
    const base = safeBaseName(decodeOriginalName(file.originalname));
    cb(null, `${id}-${base}.hwp`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (ext !== ".hwp") {
      cb(new Error("HWP 파일만 업로드할 수 있습니다."));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 30 * 1024 * 1024 },
});

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(ROOT, "public")));

function commandName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...(options.env || {}) };
    if (process.versions.electron && command === process.execPath) {
      env.ELECTRON_RUN_AS_NODE = "1";
    }

    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      shell: options.shell || false,
      windowsHide: true,
      env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(stderr || stdout || `${command} exited with ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      }
    });
  });
}

function getHwpWorkerInvocation() {
  const configuredWorker = process.env.HWP_WORKER_EXE;
  const workerExe = configuredWorker || BUNDLED_HWP_WORKER;

  if (process.platform === "win32" && workerExe && existsSync(workerExe)) {
    return {
      mode: "bundled-exe",
      command: workerExe,
      prefixArgs: [],
    };
  }

  return {
    mode: "python-script",
    command: process.platform === "win32" ? "python" : "python3",
    prefixArgs: [HWP_WORKER_SCRIPT],
  };
}

function getHwpWorkerTempDir() {
  if (process.env.HWP_AUTOFILL_TEMP_DIR) return process.env.HWP_AUTOFILL_TEMP_DIR;
  if (process.platform === "win32") {
    const publicRoot = process.env.PUBLIC || "C:\\Users\\Public";
    return path.join(publicRoot, "Documents", "HwpAutofill", "jobs");
  }
  return path.join(WORK_DIR, "hwp-jobs");
}

async function pathStatus(targetPath) {
  try {
    const stat = await fs.stat(targetPath);
    return { exists: true, isFile: stat.isFile(), isDirectory: stat.isDirectory(), size: stat.size };
  } catch (error) {
    return { exists: false, error: error.message };
  }
}

async function testWritableDirectory(targetDir) {
  const probePath = path.join(targetDir, `probe-${Date.now()}.txt`);
  try {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(probePath, "ok", "utf8");
    await fs.unlink(probePath);
    return { ok: true, path: targetDir };
  } catch (error) {
    return { ok: false, path: targetDir, error: error.message };
  }
}

async function runOptional(command, args, options = {}) {
  try {
    const result = await runCommand(command, args, options);
    return { ok: true, command, args, stdout: result.stdout.slice(0, 2000), stderr: result.stderr.slice(0, 2000) };
  } catch (error) {
    return {
      ok: false,
      command,
      args,
      error: error.message,
      stdout: (error.stdout || "").slice(0, 2000),
      stderr: (error.stderr || "").slice(0, 2000),
      code: error.code,
    };
  }
}

async function hwpToMarkdown(filePath, prefix) {
  await ensureDirs();
  const outPath = path.join(WORK_DIR, `${prefix}-${Date.now()}.md`);
  const data = await fs.readFile(filePath);
  const result = toMarkdown(data, { image: "blob" });
  await fs.writeFile(outPath, result.markdown, "utf8");
  return {
    markdown: result.markdown,
    markdownPath: outPath,
  };
}

async function hwpInfo(filePath) {
  try {
    const data = await fs.readFile(filePath);
    const header = JSON.parse(fileHeader(data));
    let imageCount = 0;
    try {
      const document = JSON.parse(toJson(data));
      imageCount = document.bin_data?.items?.length || 0;
    } catch {
      imageCount = 0;
    }

    return [
      "HWP File Information",
      `Version: ${header.version || ""}`,
      `Compressed: ${header.compressed ? "Yes" : "No"}`,
      `Encrypted: ${header.encrypted ? "Yes" : "No"}`,
      `Images: ${imageCount}`,
    ].join("\n");
  } catch (error) {
    return error.stdout || error.stderr || "";
  }
}

async function saveJson(fileName, data) {
  await ensureDirs();
  const filePath = path.join(DATA_DIR, fileName);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  return filePath;
}

app.get("/api/health", async (req, res) => {
  res.json({
    ok: true,
    version: packageInfo.version,
    port: PORT,
    dataRoot: DATA_ROOT,
    hwpWorker: process.platform === "win32",
    hwpWorkerMode: getHwpWorkerInvocation().mode,
  });
});

app.get("/api/diagnostics", async (req, res) => {
  const workerInvocation = getHwpWorkerInvocation();
  const tempDir = getHwpWorkerTempDir();
  const diagnostics = {
    ok: true,
    app: {
      name: packageInfo.name,
      version: packageInfo.version,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron || null,
      node: process.versions.node,
    },
    paths: {
      root: ROOT,
      dataRoot: DATA_ROOT,
      tempDir,
      workerCommand: workerInvocation.command,
      workerMode: workerInvocation.mode,
    },
    checks: {
      dataRootWritable: await testWritableDirectory(DATA_ROOT),
      tempDirWritable: await testWritableDirectory(tempDir),
      bundledWorker: await pathStatus(BUNDLED_HWP_WORKER),
      workerHelp: await runOptional(workerInvocation.command, [...workerInvocation.prefixArgs, "--help"]),
      hwpComRegistry:
        process.platform === "win32"
          ? await runOptional("reg", ["query", "HKCR\\HWPFrame.HwpObject\\CLSID"])
          : { ok: false, error: "Windows only" },
    },
  };
  res.json(diagnostics);
});

app.post("/api/profile/extract", upload.single("hwp"), async (req, res, next) => {
  try {
    if (!req.file) throw new Error("업로드된 HWP 파일이 없습니다.");
    const { markdown } = await hwpToMarkdown(req.file.path, "resume");
    const info = await hwpInfo(req.file.path);
    const profile = extractProfileFromMarkdown(markdown);
    profile.source = {
      uploadId: path.parse(req.file.filename).name,
      originalName: decodeOriginalName(req.file.originalname),
      path: req.file.path,
      info,
    };
    await saveJson("profile.latest.json", profile);
    res.json({ profile, markdownPreview: markdown.slice(0, 5000) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/template/analyze", upload.single("hwp"), async (req, res, next) => {
  try {
    if (!req.file) throw new Error("업로드된 HWP 파일이 없습니다.");
    const { markdown } = await hwpToMarkdown(req.file.path, "template");
    const info = await hwpInfo(req.file.path);
    const template = analyzeTemplateMarkdown(markdown);
    template.source = {
      uploadId: path.parse(req.file.filename).name,
      originalName: decodeOriginalName(req.file.originalname),
      path: req.file.path,
      info,
    };
    await saveJson("template.latest.json", template);
    res.json({ template, markdownPreview: markdown.slice(0, 7000) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/draft", async (req, res, next) => {
  try {
    const { profile, template } = req.body;
    if (!profile || !template) throw new Error("프로필과 양식 분석 결과가 필요합니다.");
    const draft = buildDraftValues(profile, template);
    await saveJson("draft.latest.json", draft);
    res.json({ draft });
  } catch (error) {
    next(error);
  }
});

app.post("/api/generate", async (req, res, next) => {
  try {
    const { profile, template, draft } = req.body;
    if (!profile || !template || !draft) {
      throw new Error("HWP 생성을 위해 프로필, 양식, 중간값이 모두 필요합니다.");
    }
    const templatePath = template?.source?.path;
    if (!templatePath || !existsSync(templatePath)) {
      throw new Error("원본 HWP 양식 파일을 찾을 수 없습니다. 양식을 다시 업로드해 주세요.");
    }

    const id = randomUUID();
    const draftPath = path.join(WORK_DIR, `${id}.draft.json`);
    const outputName = `${id}-자동작성_완성본.hwp`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    await fs.writeFile(draftPath, JSON.stringify({ profile, template, draft }, null, 2), "utf8");

    const workerInvocation = getHwpWorkerInvocation();
    const { stdout, stderr } = await runCommand(workerInvocation.command, [
      ...workerInvocation.prefixArgs,
      "--template",
      templatePath,
      "--draft",
      draftPath,
      "--output",
      outputPath,
    ], {
      env: {
        HWP_AUTOFILL_TEMP_DIR: getHwpWorkerTempDir(),
      },
    });

    let worker = {};
    try {
      worker = JSON.parse(stdout.trim().split(/\r?\n/).pop());
    } catch {
      worker = { stdout, stderr };
    }

    res.json({
      ok: true,
      outputName,
      downloadUrl: `/api/download/${encodeURIComponent(outputName)}`,
      workerMode: workerInvocation.mode,
      worker,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/download/:file", async (req, res, next) => {
  try {
    const file = path.basename(req.params.file);
    const filePath = path.join(OUTPUT_DIR, file);
    if (!existsSync(filePath)) throw new Error("다운로드 파일을 찾을 수 없습니다.");
    res.setHeader("Content-Type", "application/x-hwp");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file)}`);
    createReadStream(filePath).pipe(res);
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(400).json({
    error: error.message || "요청 처리 중 오류가 발생했습니다.",
    detail: error.stderr || error.stdout || undefined,
  });
});

async function startServer(port = PORT, host = HOST) {
  await ensureDirs();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        host,
        port: actualPort,
        url: `http://${host}:${actualPort}`,
      });
    });
    server.on("error", reject);
  });
}

if (require.main === module) {
  startServer()
    .then(({ url }) => {
      console.log(`HWP resume autofill MVP: ${url}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  app,
  startServer,
  ensureDirs,
  paths: {
    root: ROOT,
    dataRoot: DATA_ROOT,
    uploadDir: UPLOAD_DIR,
    outputDir: OUTPUT_DIR,
    workDir: WORK_DIR,
    dataDir: DATA_DIR,
  },
};
