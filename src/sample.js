const generate = require('@babel/generator').default;
const t = require('@babel/types');
const chalk = require('chalk');
const {sample} = require('testcheck');
const {genProgram} = require('./gen');
const {divider} = require('./report');

Error.stackTraceLimit = Infinity;

const genCode = genProgram.then(program => generate(program).code);
const samples = sample(genCode);

console.log(divider);
samples.forEach(e => {
  console.log(e);
  console.log(divider);
});
