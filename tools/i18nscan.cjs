const path = require('path')
const root = path.resolve(process.argv[2])
const ts = require(path.join(root, 'node_modules', 'typescript'))
const config = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
const program = ts.createProgram(config.fileNames, config.options)
const checker = program.getTypeChecker()
const found = []
for (const sf of program.getSourceFiles()) {
  if (!sf.fileName.startsWith(path.join(root, 'startos'))) continue
  const visit = (n) => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === 'i18n' && n.arguments.length > 1) {
      const params = n.arguments[1]
      for (const p of checker.getTypeAtLocation(params).getProperties()) {
        const t = checker.getTypeOfSymbolAtLocation(p, params)
        if (!(t.flags & ts.TypeFlags.StringLike)) {
          const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf))
          found.push(`${path.relative(root, sf.fileName)}:${line + 1} ${p.name}: ${checker.typeToString(t)}`)
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}
console.log(found.length ? found.join('\n') : 'clean')
