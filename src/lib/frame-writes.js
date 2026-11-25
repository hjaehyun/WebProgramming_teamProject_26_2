// Frame changes for one day are sent one at a time, in the order they were chosen, so the last
// choice is the one the server keeps. Unlike fragment writes, a failed change does not hold back
// the next one: each choice stands on its own. Different days never wait for each other.
export function createFrameWrites(send) {
  const tails = new Map();
  return {
    write(date, frame) {
      const previous = tails.get(date) ?? Promise.resolve();
      const request = previous.catch(() => {}).then(() => send(date, frame));
      tails.set(date, request);
      const finish = () => { if (tails.get(date) === request) tails.delete(date); };
      request.then(finish, finish);
      return request;
    },
  };
}
