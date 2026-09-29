// The bash effect classifier (#26 option B) — the local-effect axis derived
// by the same authority that finds network targets. The record pins the
// semantics: a CLOSED read-only vocabulary, split at the shell separators,
// the compound's class is the MAX of its parts, any unprovable part poisons
// the whole to null. Worked examples are the record's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bashEffectClassOf } from '../src/analyzer.js';

const cls = (command) => bashEffectClassOf({ command })?.effectClass;
const verbsOf = (command) => bashEffectClassOf({ command })?.verbs;

test('provable reads: the vocabulary classes the verb, args are irrelevant to the class', () => {
  assert.equal(cls('ls /'), 'read');
  assert.deepEqual(verbsOf('ls /'), ['ls']);
  assert.equal(cls('ls -la /workspace'), 'read');
  assert.equal(cls('cat /etc/hosts'), 'read');
  assert.equal(cls('pwd'), 'read');
  assert.equal(cls('printenv GH_TOKEN'), 'read');
});

test('the compound is the max of its parts — the record\'s worked case', () => {
  // `ls -la / && rm -rf /toto`: rm is off the read-only vocabulary → the
  // whole line is unprovable → null → command-scoped identity. It never
  // inherits the leading `ls`'s read class.
  assert.equal(cls('ls -la / && rm -rf /toto'), null);
  assert.equal(cls('ls / ; rm -rf /toto'), null);
  // an all-read compound stays read, with the verb SET as its identity
  assert.equal(cls('ls / && ls /tmp'), 'read');
  assert.deepEqual(verbsOf('ls / && ls /tmp'), ['ls']);
  assert.equal(cls('cat a | sort | uniq'), 'read');
  assert.deepEqual(verbsOf('cat a | sort | uniq'), ['cat', 'sort', 'uniq']);
});

test('non-bash execution is null by construction — the classifier never peers inside an interpreter', () => {
  assert.equal(cls('python -c "import os; os.system(\'ls\')"'), null);
  assert.equal(cls('perl -e "print 1"'), null);
  assert.equal(cls('node -e "console.log(1)"'), null);
  assert.equal(cls('bash -c "ls /"'), null, 'even bash-as-a-wrapper: the wrapper verb is what is classified');
  assert.equal(cls('pwsh -Command Get-ChildItem'), null);
});

test('unresolvable parts poison the whole line', () => {
  assert.equal(cls('ls && $SCRIPT'), null, 'a variable could expand to anything');
  assert.equal(cls('ls `which curl`'), null, 'substitution');
  assert.equal(cls('ls ${HOME}'), null);
  assert.equal(cls('ls / && echo $HOME'), null);
});

test('local writes poison: redirects and output flags', () => {
  assert.equal(cls('cat /etc/hosts > /tmp/out'), null);
  assert.equal(cls('ls >> log'), null);
  assert.equal(cls('curl https://x -o /tmp/body'), null, 'curl writing a file is not a provable read');
  assert.equal(cls('curl https://x --output /tmp/body'), null);
  assert.equal(cls('curl https://x 2>&1 | cat'), null, 'fd duplication poisons too — conservative, documented');
});

test('network reads keep their class: curl to stdout is a provable read', () => {
  assert.equal(cls('curl https://api.example.com/v1'), 'read');
  assert.equal(cls('curl -sSL https://api.example.com/v1'), 'read');
});

test('git is subcommand-structured: status reads, push poisons', () => {
  assert.equal(cls('git status'), 'read');
  assert.deepEqual(verbsOf('git status'), ['git:status']);
  assert.equal(cls('git log --oneline'), 'read');
  assert.equal(cls('git push origin main'), null);
  assert.equal(cls('git commit -m x'), null);
});

test('mutating verbs are off-vocabulary: the package managers, rm, dd, tee', () => {
  assert.equal(cls('npm install lodash'), null);
  assert.equal(cls('pip install requests'), null);
  assert.equal(cls('apt-get install -y jq'), null);
  assert.equal(cls('wget https://x'), null, 'wget saves its body to a file by default');
  assert.equal(cls('dd if=/x of=/y'), null);
  assert.equal(cls('echo hi | tee /tmp/out'), null);
});

test('env assignments before a read verb do not hide it', () => {
  assert.equal(cls('LC_ALL=C ls /'), 'read');
});

test('no command-shaped argument → null, never guessed', () => {
  assert.equal(bashEffectClassOf({}), null);
  assert.equal(bashEffectClassOf({ command: '' }), null);
  assert.equal(bashEffectClassOf({ command: '   ' }), null);
});
