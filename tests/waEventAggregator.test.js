import { jest } from '@jest/globals';
import { handleIncoming } from '../src/service/waEventAggregator.js';

afterEach(() => {
  jest.useRealTimers();
});

test('baileys processes messages without delay', () => {
  jest.useFakeTimers();
  const handler = jest.fn();
  const msg = { from: '123', id: { id: 'abc', _serialized: 'abc' } };

  handleIncoming('baileys', msg, handler);
  jest.runAllTimers();

  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledWith(msg);
});

test('duplicate messages are filtered', () => {
  jest.useFakeTimers();
  const handler = jest.fn();
  const msg = { from: '456', id: { id: 'def', _serialized: 'def' } };

  handleIncoming('baileys', msg, handler);
  handleIncoming('baileys', msg, handler);
  jest.runAllTimers();

  expect(handler).toHaveBeenCalledTimes(1);
});

test('messages with different IDs are processed separately', () => {
  const handler = jest.fn();
  const msg1 = { from: '789', id: { id: 'xyz', _serialized: 'xyz' } };
  const msg2 = { from: '789', id: { id: 'uvw', _serialized: 'uvw' } };

  handleIncoming('baileys', msg1, handler);
  handleIncoming('baileys', msg2, handler);

  expect(handler).toHaveBeenCalledTimes(2);
});
