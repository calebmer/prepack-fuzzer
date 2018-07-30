const t = require('@babel/types');
const {gen} = require('testcheck');

const Types = {
  unknown: 'unknown',
  nullish: 'nullish',
  number: 'number',
  string: 'string',
  boolean: 'boolean',
  function0: 'function0',
};

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
    };
  }

  function getInitialScope() {
    return {
      variables: [],
    };
  }

  let state = null;

  function newVariable(type) {
    const name = `x${state.nextVariableId++}`;
    state.scopes[state.scopes.length - 1].variables.push({name, type});
    return name;
  }

  function newFunction(type) {
    const name = `f${state.nextFunctionId++}`;
    state.scopes[state.scopes.length - 1].variables.push({name, type});
    return name;
  }

  const genScalarComputationWeightedCases = [
    // null / undefined
    [
      5,
      {
        statements: [],
        type: gen.return(Types.nullish),
        expression: gen.oneOf([
          gen.return(t.nullLiteral()),
          gen.return(t.identifier('undefined')),
        ]),
      },
    ],

    // number
    [
      1,
      {
        statements: [],
        type: gen.return(Types.number),
        expression: gen.number.then(n => gen.return(t.numericLiteral(n))),
      },
    ],

    // string
    [
      1,
      {
        statements: [],
        type: gen.return(Types.string),
        expression: genStringLiteral,
      },
    ],

    // boolean
    [
      10,
      {
        statements: [],
        type: gen.return(Types.boolean),
        expression: gen.boolean.then(b => t.booleanLiteral(b)),
      },
    ],
  ];

  // Reuse variable from state
  //
  // NOTE: This case must be first in `genScalarExpressionWeightedCases` so we
  // can easily take it out.
  genScalarComputationWeightedCases.unshift([
    20,
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
            variables.push(scope.variables[k]);
          }
        }
      }
      if (variables.length === 0) {
        // If we have no variables then use one of our other scalar
        // expression cases.
        return gen.oneOfWeighted(genScalarComputationWeightedCases.slice(1));
      } else {
        return gen.oneOf(variables).then(v =>
          gen.return({
            statements: [],
            type: v.type,
            expression: t.identifier(v.name),
          })
        );
      }
    }),
  ]);

  const genScalarComputation = gen.oneOfWeighted(
    genScalarComputationWeightedCases
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
          // If our consequent and/or alternate have statements then we need to
          // hoist these statements to an if-statement.
          const conditionReuse =
            (consequent.statements.length !== 0 ||
              alternate.statements.length !== 0) &&
            t.identifier(newVariable(condition.type));
          if (conditionReuse) {
            condition.statements.push(
              t.variableDeclaration('var', [
                t.variableDeclarator(conditionReuse, condition.expression),
              ])
            );
            if (
              consequent.statements.length === 0 &&
              alternate.statements.length !== 0
            ) {
              condition.statements.push(
                t.ifStatement(
                  t.unaryExpression('!', conditionReuse),
                  t.blockStatement(alternate.statements)
                )
              );
            } else {
              condition.statements.push(
                t.ifStatement(
                  conditionReuse,
                  t.blockStatement(consequent.statements),
                  alternate.statements.length === 0
                    ? undefined
                    : t.blockStatement(alternate.statements)
                )
              );
            }
          }
          return gen.return({
            statements: condition.statements,
            type:
              consequent.type === alternate.type
                ? consequent.type
                : Types.unknown,
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
            condition,
            consequent,
            alternate,
            returnConsequent,
            returnAlternate,
          }) => {
            const type =
              returnConsequent && !returnAlternate
                ? alternate.type
                : returnAlternate && !returnConsequent
                  ? consequent.type
                  : consequent.type === alternate.type
                    ? consequent.type
                    : Types.unknown;

            const variable = newVariable(type);

            condition.statements.push(
              t.variableDeclaration('var', [
                t.variableDeclarator(t.identifier(variable)),
              ])
            );
            if (returnConsequent) {
              consequent.statements.push(
                t.returnStatement(consequent.expression)
              );
            } else {
              consequent.statements.push(
                t.expressionStatement(
                  t.assignmentExpression(
                    '=',
                    t.identifier(variable),
                    consequent.expression
                  )
                )
              );
            }
            if (returnAlternate) {
              alternate.statements.push(
                t.returnStatement(alternate.expression)
              );
            } else {
              alternate.statements.push(
                t.expressionStatement(
                  t.assignmentExpression(
                    '=',
                    t.identifier(variable),
                    alternate.expression
                  )
                )
              );
            }
            condition.statements.push(
              t.ifStatement(
                condition.expression,
                t.blockStatement(consequent.statements),
                t.blockStatement(alternate.statements)
              )
            );

            return gen.return({
              statements: condition.statements,
              type,
              expression: t.identifier(variable),
            });
          }
        ),
      ],

      // var id = init;
      [
        30,
        genComputation.then(({statements, type, expression}) => {
          const variable = newVariable(type);
          statements.push(
            t.variableDeclaration('var', [
              t.variableDeclarator(t.identifier(variable), expression),
            ])
          );
          return gen.return({
            statements,
            type,
            expression: t.identifier(variable),
          });
        }),
      ],

      // function f(...args) { body }
      [
        15,
        gen.null.then(() => {
          // Save old scopes
          const prevScopes = state.scopes;
          state.scopes = [getInitialScope()];

          return genComputation.then(computation => {
            // Restore old scopes
            state.scopes = prevScopes;

            computation.statements.push(
              t.returnStatement(computation.expression)
            );
            const type = Types.function0;
            const name = newFunction(type);
            const declaration = t.functionDeclaration(
              t.identifier(name),
              [],
              t.blockStatement(computation.statements)
            );
            state.declarations.push(declaration);
            return gen.return({
              statements: [],
              type: computation.type,
              expression: t.callExpression(t.identifier(name), []),
            });
          });
        }),
      ],

      // ignored; computation
      [
        1,
        gen([genComputation, genComputation]).then(([ignored, computation]) => {
          const {statements} = ignored;
          statements.push(t.expressionStatement(ignored.expression));
          pushAll(statements, computation.statements);
          return gen.return({
            statements,
            type: computation.type,
            expression: computation.expression,
          });
        }),
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

function pushAll(target, ...sources) {
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    for (let k = 0; k < source.length; k++) {
      target.push(source[k]);
    }
  }
}

module.exports = {genComputation};
