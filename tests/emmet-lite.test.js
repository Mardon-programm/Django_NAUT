// Emmet-lite: HTML abbreviation expansion is pure and testable.
const { test, eq, repoRoot } = require('./lib');
const path = require('path');

const emmet = require(path.join(repoRoot(), 'emmet-lite.js'));
const isNull = (v) => eq(v, null);

test('expands a plain tag', () => {
  eq(emmet.expandAbbreviation('div'), '<div></div>');
  eq(emmet.expandAbbreviation('span'), '<span></span>');
});

test('expands id and classes', () => {
  eq(emmet.expandAbbreviation('div#app'), '<div id="app"></div>');
  eq(emmet.expandAbbreviation('div.main.item'), '<div class="main item"></div>');
  eq(emmet.expandAbbreviation('a#home.link.bold'), '<a id="home" class="link bold"></a>');
});

test('expands nesting with >', () => {
  eq(emmet.expandAbbreviation('div>p'), '<div><p></p></div>');
  eq(emmet.expandAbbreviation('ul>li>a'), '<ul><li><a></a></li></ul>');
});

test('expands repetition with *n', () => {
  eq(emmet.expandAbbreviation('li*3'), '<li></li>\n<li></li>\n<li></li>');
  eq(emmet.expandAbbreviation('ul>li*2'), '<ul><li></li>\n<li></li></ul>');
});

test('expands text content with {}', () => {
  eq(emmet.expandAbbreviation('a{Click here}'), '<a>Click here</a>');
  eq(emmet.expandAbbreviation('button{Save}'), '<button>Save</button>');
});

test('self-closing tags', () => {
  eq(emmet.expandAbbreviation('img'), '<img/>');
  eq(emmet.expandAbbreviation('br'), '<br/>');
  eq(emmet.expandAbbreviation('input'), '<input/>');
});

test('! expands to HTML5 boilerplate', () => {
  const out = emmet.expandAbbreviation('!');
  eq(out.startsWith('<!DOCTYPE html>'), true);
  eq(out.includes('<html lang="en">'), true);
  eq(out.includes('</html>'), true);
});

test('invalid abbreviations return null', () => {
  isNull(emmet.expandAbbreviation(''));
  isNull(emmet.expandAbbreviation(null));
  isNull(emmet.expandAbbreviation('123'));
  isNull(emmet.expandAbbreviation('foo bar baz'));
  isNull(emmet.expandAbbreviation('.'));
});
