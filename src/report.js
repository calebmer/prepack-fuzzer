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

function reportTestFinish(time, size, status) {
  const icon = statusIcon[status];
  const verb = statusVerb[status];
  console.log(`${icon} Test of size ${size} ${verb} in ${prettyMs(time)}`);
}

module.exports = {
  ReportStatus,
  passIcon: statusIcon.pass,
  failIcon: statusIcon.fail,
  divider,
  reportTestFinish,
};
