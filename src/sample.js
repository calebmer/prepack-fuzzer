const generate = require('@babel/generator').default;
const t = require('@babel/types');
const {sample} = require('testcheck');
const {genComputation} = require('./gen');

Error.stackTraceLimit = Infinity;

const genCode = genComputation().then(({declarations, computation}) => {
  computation.statements.push(t.returnStatement(computation.expression));
  const program = [
    t.functionDeclaration(
      t.identifier('main'),
      [],
      t.blockStatement(computation.statements)
    ),
  ];
  declarations.forEach(declaration => {
    program.push(declaration);
  });
  return generate(t.program(program)).code;
});

const samples = sample(genCode);

console.log('-'.repeat(process.stdout.columns));
samples.forEach(e => {
  console.log(e);
  console.log('-'.repeat(process.stdout.columns));
});
