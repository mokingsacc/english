// Truck turns: the swept path of a design truck through each movement. Built in a later part of First Pass;
// until then the check says so.

export default {
  id: 'truck-turns',
  title: 'Truck turns',
  order: 80,
  needsShape: false,
  unit: null,
  run() {
    return {
      status: 'info',
      value: null,
      unit: null,
      limit: null,
      items: [],
      explain: 'Truck turning paths are not built yet. They come in a later part of First Pass, so check truck turns another way for now.',
      fix: null,
      where: {},
    };
  },
};
