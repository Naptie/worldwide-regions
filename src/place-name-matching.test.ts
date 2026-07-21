import assert from 'node:assert/strict';
import test from 'node:test';
import { countryNameForms, levenshteinSimilarity, placeNameForms } from './place-name-matching.js';

test('placeNameForms strips qualifiers and parentheses', () => {
  assert.equal(placeNameForms('성남시 (Seongnam-si)').has('seongnam'), true);
  assert.equal(placeNameForms('Haymarket, Sydney').has('haymarket'), true);
  assert.equal(placeNameForms('Miyagi-ken').has('miyagi'), true);
});

test('countryNameForms handles political prefixes', () => {
  assert.equal(countryNameForms('United States of America').has('america'), true);
  assert.equal(countryNameForms("People's Republic of China").has('china'), true);
  assert.equal(countryNameForms('Kingdom of the Netherlands').has('netherlands'), true);
  assert.equal(countryNameForms('United States').has('unitedstates'), true);
  assert.equal(countryNameForms('Myanmar (Burma)').has('myanmar'), true);
});

test('levenshteinSimilarity returns reasonable scores', () => {
  assert.equal(levenshteinSimilarity('gwangin', 'gwangjin') >= 0.87, true);
  assert.equal(levenshteinSimilarity('hello', 'hello'), 1);
  assert.equal(levenshteinSimilarity('abc', 'xyz'), 0);
});
