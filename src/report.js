const util = require('util');
const chalk = require('chalk');
const prettyMs = require('pretty-ms');

const ReportStatus = {
  pass: 'pass',
  fail: 'fail',
  skip: 'timeout',
};

const statusIcon = {
  pass: chalk.green('✔'),
  fail: chalk.red('✘'),
  skip: chalk.yellow('!'),
};

const statusVerb = {
  pass: 'passed',
  fail: 'failed',
  skip: 'skipped',
};

const divider = chalk.dim('┈'.repeat(process.stdout.columns));

function reportTestFinish(time, status) {
  const icon = statusIcon[status];
  const verb = statusVerb[status];
  console.log(`${icon} Test ${verb} in ${prettyMs(time)}`);
}

function reportFailedResults(args, expected, actual) {
  let first = true;
  args.forEach((args, i) => {
    if (expected[i].value !== actual[i].value) {
      if (!first) {
        console.error();
      }
      first = false;
      console.error(`${chalk.dim('Arguments:')} ${inspect(args)}`);
      console.error(` ${chalk.dim('Expected:')} ${inspect(expected[i].value)}`);
      console.error(`   ${chalk.dim('Actual:')} ${inspect(actual[i].value)}`);
    }
  });
}

function inspect(value) {
  return util.inspect(value, {colors: true});
}

module.exports = {
  ReportStatus,
  passIcon: statusIcon.pass,
  failIcon: statusIcon.fail,
  divider,
  reportTestFinish,
  reportFailedResults,
};
