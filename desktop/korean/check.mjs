import path from "node:path";
import ts from "typescript";
import {
  checkOverlay,
  desktopRoot,
  koreanRoot,
  manifest,
  transformSource,
} from "./overlay.mjs";

const count = checkOverlay();
const configPath = path.join(desktopRoot, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error)
  throw new Error(
    ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
  );
const parsed = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  desktopRoot,
);
parsed.options.paths = {
  ...parsed.options.paths,
  "@buzz-korean/*": [path.join(koreanRoot, "runtime/*")],
};
const host = ts.createCompilerHost(parsed.options);
const readFile = host.readFile.bind(host);
host.readFile = (filename) => {
  const source = readFile(filename);
  return source === undefined ? undefined : transformSource(source, filename);
};
const program = ts.createProgram({
  rootNames: [
    ...parsed.fileNames,
    path.join(koreanRoot, "runtime/LanguageSetting.tsx"),
  ],
  options: parsed.options,
  host,
});
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (filename) => filename,
      getCurrentDirectory: () => desktopRoot,
      getNewLine: () => "\n",
    }),
  );
  process.exitCode = 1;
} else {
  console.log(
    `Korean overlay: ${count} UI bindings and transformed TypeScript passed (base ${manifest.baseVersion}, ${manifest.baseCommit.slice(0, 12)}).`,
  );
}
