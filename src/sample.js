const generate = require('@babel/generator').default;
const t = require('@babel/types');
const {sample} = require('testcheck');
const {genComputation} = require('./gen');

const genCode = genComputation().then(computation => {
  computation.statements.push(t.returnStatement(computation.expression));
  return generate(
    t.program([
      t.functionDeclaration(
        t.identifier('main'),
        [],
        t.blockStatement(computation.statements)
      ),
    ])
  ).code;
});

const samples = sample(genCode);

console.log('-'.repeat(process.stdout.columns));
samples.forEach(e => {
  console.log(e);
  console.log('-'.repeat(process.stdout.columns));
});
