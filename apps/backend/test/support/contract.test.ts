// Pruebas del validador de contrato (T-014).
import { describe, expect, it } from 'vitest';
import { expectToMatchContract, type ContractResponse } from './contract.js';

function jsonResponse(status: number, body: unknown): ContractResponse {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body };
}

describe('expectToMatchContract', () => {
  it('acepta una respuesta que cumple el contrato', () => {
    expect(() => {
      expectToMatchContract(jsonResponse(200, { estado: 'ok' }), 'get', '/salud');
    }).not.toThrow();
  });

  it('rechaza un campo no documentado', () => {
    expect(() => {
      expectToMatchContract(jsonResponse(200, { estado: 'ok', version: '1.0.0' }), 'get', '/salud');
    }).toThrow(/no cumple el contrato/);
  });

  it('rechaza un valor que el esquema no admite', () => {
    expect(() => {
      expectToMatchContract(jsonResponse(200, { estado: 'caido' }), 'get', '/salud');
    }).toThrow(/no cumple el contrato/);
  });

  it('rechaza un estado no documentado para la operación', () => {
    expect(() => {
      expectToMatchContract(jsonResponse(500, { estado: 'ok' }), 'get', '/salud');
    }).toThrow(/no está documentado/);
  });

  it('rechaza un tipo de contenido distinto del documentado', () => {
    const response = { status: 200, headers: { 'content-type': 'text/html' }, body: 'ok' };
    expect(() => {
      expectToMatchContract(response, 'get', '/salud');
    }).toThrow(/respondió "text\/html"/);
  });

  it('rechaza una operación que no está en el contrato', () => {
    expect(() => {
      expectToMatchContract(jsonResponse(200, {}), 'post', '/salud');
    }).toThrow(/no está en el contrato/);
  });
});
