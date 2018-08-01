const t = require('@babel/types');
const Immutable = require('immutable');
const {gen} = require('testcheck');

const genStringLiteral = gen
  .array(gen.asciiChar, {maxSize: 20})
  .then(chars => gen.return(t.stringLiteral(chars.join(''))));

function genComputation() {
  function getInitialState() {
    return {
      declarations: [],
      scopes: [getInitialScope()],
      nextVariableId: 1,
      nextFunctionId: 1,
      arguments: null,
    };
  }

  function getInitialScope() {
    return {
      variables: [],
      functions: [],
    };
  }

  let state = null;

  function newVariable() {
    const name = `x${state.nextVariableId++}`;
    state.scopes[state.scopes.length - 1].variables.push({name});
    return name;
  }

  function newFunction(arity) {
    const name = `f${state.nextFunctionId++}`;
    state.scopes[state.scopes.length - 1].functions.push({name, arity});
    return name;
  }

  function newArgument() {
    if (state.arguments === null) {
      return null;
    } else {
      const name = `a${state.arguments++ + 1}`;
      state.scopes[state.scopes.length - 1].variables.push({name});
      return name;
    }
  }

  const genScalarExpressionWeightedCases = [
    // null / undefined
    [
      5,
      gen.oneOf([
        gen.return(t.nullLiteral()),
        gen.return(t.identifier('undefined')),
      ]),
    ],

    // number
    [1, gen.number.then(n => gen.return(t.numericLiteral(n)))],

    // string
    [1, genStringLiteral],

    // boolean
    [10, gen.boolean.then(b => t.booleanLiteral(b))],
  ];

  const genScalarExpression = gen.oneOfWeighted([
    ...genScalarExpressionWeightedCases,

    // Reuse variable
    [
      5,
      gen.null.then(() => {
        let variables = [];
        // Reuse the variables array if we only have one. Otherwise add all scope
        // variables to our local variables array.
        if (state.scopes.length === 1) {
          variables = state.scopes[0].variables;
        } else {
          for (let i = 0; i < state.scopes.length; i++) {
            const scope = state.scopes[i];
            for (let k = 0; k < scope.variables.length; k++) {
              variables.push(gen.return(scope.variables[k]));
            }
          }
        }
        if (variables.length === 0) {
          return gen.oneOfWeighted(genScalarExpressionWeightedCases);
        } else {
          return gen
            .oneOf(variables)
            .then(v => gen.return(t.identifier(v.name)));
        }
      }),
    ],

    // Function argument
    [
      20,
      gen.null.then(() => {
        const argument = newArgument();
        if (argument === null) {
          return gen.oneOfWeighted(genScalarExpressionWeightedCases);
        } else {
          return gen.return(t.identifier(argument));
        }
      }),
    ],
  ]);

  const genScalarComputation = genScalarExpression.then(expression =>
    gen.return({
      statements: Immutable.List(),
      expression,
    })
  );

  const genComputation = gen.nested(genComputation => {
    // Hack in scope tracking by pushing/popping state.
    const genConditionalComputation = gen.null
      .then(() => {
        state.scopes.push(getInitialScope());
        return genComputation;
      })
      .then(computation => {
        state.scopes.pop();
        return gen.return(computation);
      });

    return gen.oneOfWeighted([
      // condition ? consequent : alternate
      [
        5,
        gen({
          condition: genComputation,
          consequent: genConditionalComputation,
          alternate: genConditionalComputation,
        }).then(({condition, consequent, alternate}) => {
          let statements = condition.statements;
          // If our consequent and/or alternate have statements then we need to
          // hoist these statements to an if-statement.
          const conditionReuse =
            (!consequent.statements.isEmpty() ||
              !alternate.statements.isEmpty()) &&
            t.identifier(newVariable());
          if (conditionReuse) {
            statements = statements.push(
              t.variableDeclaration('var', [
                t.variableDeclarator(conditionReuse, condition.expression),
              ])
            );
            if (
              consequent.statements.isEmpty() &&
              !alternate.statements.isEmpty()
            ) {
              statements = statements.push(
                t.ifStatement(
                  t.unaryExpression('!', conditionReuse),
                  t.blockStatement(alternate.statements.toArray())
                )
              );
            } else {
              statements = statements.push(
                t.ifStatement(
                  conditionReuse,
                  t.blockStatement(consequent.statements.toArray()),
                  alternate.statements.size === 0
                    ? undefined
                    : t.blockStatement(alternate.statements.toArray())
                )
              );
            }
          }
          return gen.return({
            statements,
            expression: t.conditionalExpression(
              conditionReuse || condition.expression,
              consequent.expression,
              alternate.expression
            ),
          });
        }),
      ],

      // if (condition) { consequent } else { alternate }
      [
        10,
        gen({
          condition: genComputation,
          consequent: genConditionalComputation,
          alternate: genConditionalComputation,
          returnConsequent: gen.oneOfWeighted([
            [1, gen.return(true)],
            [3, gen.return(false)],
          ]),
          returnAlternate: gen.oneOfWeighted([
            [1, gen.return(true)],
            [3, gen.return(false)],
          ]),
        }).then(
          ({
            condition: {statements, expression: conditionExpression},
            consequent: {
              statements: consequentStatements,
              expression: consequentExpression,
            },
            alternate: {
              statements: alternateStatements,
              expression: alternateExpression,
            },
            returnConsequent,
            returnAlternate,
          }) => {
            const variable = newVariable();

            statements = statements.push(
              t.variableDeclaration('var', [
                t.variableDeclarator(t.identifier(variable)),
              ])
            );
            if (returnConsequent) {
              consequentStatements = consequentStatements.push(
                t.returnStatement(consequentExpression)
              );
            } else {
              consequentStatements = consequentStatements.push(
                t.expressionStatement(
                  t.assignmentExpression(
                    '=',
                    t.identifier(variable),
                    consequentExpression
                  )
                )
              );
            }
            if (returnAlternate) {
              alternateStatements = alternateStatements.push(
                t.returnStatement(alternateExpression)
              );
            } else {
              alternateStatements = alternateStatements.push(
                t.expressionStatement(
                  t.assignmentExpression(
                    '=',
                    t.identifier(variable),
                    alternateExpression
                  )
                )
              );
            }
            statements = statements.push(
              t.ifStatement(
                conditionExpression,
                t.blockStatement(consequentStatements.toArray()),
                t.blockStatement(alternateStatements.toArray())
              )
            );

            return gen.return({
              statements,
              expression: t.identifier(variable),
            });
          }
        ),
      ],

      // var id = init;
      [
        20,
        genComputation.then(({statements, expression}) => {
          const variable = newVariable();
          return gen.return({
            statements: statements.push(
              t.variableDeclaration('var', [
                t.variableDeclarator(t.identifier(variable), expression),
              ])
            ),
            expression: t.identifier(variable),
          });
        }),
      ],

      // function f(...args) { body }
      [
        15,
        gen.null.then(() => {
          // Save old stuff
          const prevArguments = state.arguments;
          const prevScopes = state.scopes;

          // Set new stuff
          state.arguments = 0;
          state.scopes = [getInitialScope()];

          return genComputation
            .then(computation => {
              // Save new stuff
              const argumentsCount = state.arguments;

              // Restore old stuff
              state.arguments = prevArguments;
              state.scopes = prevScopes;

              // Generate arguments in old scope.
              return {
                computation: gen.return(computation),
                args: Array(argumentsCount).fill(genComputation),
              };
            })
            .then(
              ({
                computation: {
                  statements: functionStatements,
                  expression: functionExpression,
                },
                args,
              }) => {
                functionStatements = functionStatements.push(
                  t.returnStatement(functionExpression)
                );
                const name = newFunction(args.length);
                const declaration = t.functionDeclaration(
                  t.identifier(name),
                  args.map((c, i) => t.identifier(`a${i + 1}`)),
                  t.blockStatement(functionStatements.toArray())
                );
                state.declarations.push(declaration);

                const statements = Immutable.List().concat(
                  ...args.map(c => c.statements)
                );
                return gen.return({
                  statements,
                  expression: t.callExpression(
                    t.identifier(name),
                    args.map(c => c.expression)
                  ),
                });
              }
            );
        }),
      ],

      // f(...args)
      [
        5,
        gen.null.then(() => {
          let functions = [];
          // Reuse the functions array if we only have one. Otherwise add all
          // scope functions to our local functions array.
          if (state.scopes.length === 1) {
            functions = state.scopes[0].functions;
          } else {
            for (let i = 0; i < state.scopes.length; i++) {
              const scope = state.scopes[i];
              for (let k = 0; k < scope.functions.length; k++) {
                functions.push(gen.return(scope.functions[k]));
              }
            }
          }
          if (functions.length === 0) {
            // If we have no functions then gen a computation.
            return genComputation;
          } else {
            return gen
              .oneOf(functions)
              .then(f => {
                const args = Array(f.arity);
                args.fill(genComputation);
                return [gen.return(f), args];
              })
              .then(([f, args]) => {
                const statements = Immutable.List().concat(
                  ...args.map(c => c.statements)
                );
                return gen.return({
                  statements,
                  expression: t.callExpression(
                    t.identifier(f.name),
                    args.map(c => c.expression)
                  ),
                });
              });
          }
        }),
      ],

      // ignored; computation
      [
        1,
        gen([genComputation, genComputation]).then(
          ([
            {statements: ignoredStatements, expression: ignoredExpression},
            {statements, expression},
          ]) =>
            gen.return({
              statements: ignoredStatements
                .push(t.expressionStatement(ignoredExpression))
                .concat(statements),
              expression,
            })
        ),
      ],
    ]);
  }, genScalarComputation);

  // Hack in some state that resets for each test case since the API does not
  // explicitly provide us this. Depends on entire test cases being
  // generated synchronously.
  return gen.null
    .then(() => {
      state = getInitialState();
      return genComputation;
    })
    .then(computation => {
      const {declarations} = state;
      state = null;
      return gen.return({declarations, computation});
    });
}

const genProgramStatements = genComputation().then(
  ({
    declarations,
    computation: {statements: mainStatements, expression: mainExpression},
  }) => {
    mainStatements = mainStatements.push(t.returnStatement(mainExpression));
    const statements = [];
    declarations.forEach(declaration => {
      statements.push(declaration);
    });
    statements.push(
      t.functionDeclaration(
        t.identifier('main'),
        [],
        t.blockStatement(mainStatements.toArray())
      )
    );
    statements.push(
      t.ifStatement(
        t.memberExpression(t.identifier('global'), t.identifier('__optimize')),
        t.expressionStatement(
          t.callExpression(t.identifier('__optimize'), [t.identifier('main')])
        )
      )
    );
    statements.push(
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.memberExpression(t.identifier('module'), t.identifier('exports')),
          t.identifier('main')
        )
      )
    );
    return gen.return(statements);
  }
);

const genProgram = genProgramStatements.then(statements =>
  gen.return(t.program(statements))
);

const genPrgramWrappedInIife = genProgramStatements.then(statements =>
  gen.return(
    t.program([
      t.expressionStatement(
        t.callExpression(
          t.functionExpression(null, [], t.blockStatement(statements)),
          []
        )
      ),
    ])
  )
);

module.exports = {
  genProgram,
  genPrgramWrappedInIife,
};
