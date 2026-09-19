// Loads the app's data files from disk (the app imports them as JSON through the bundler; tests read them directly).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOWNS, ROADS } from '../../src/data/network.js';
import { createGraph } from '../../src/graph.js';
import { createAlgorithms } from '../../src/algorithms.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data');
export const readData = name => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));

export function loadGraphData() {
  return {
    towns: TOWNS, roads: ROADS,
    roadShapes: readData('roads.json'), speedLimits: readData('speeds.json'),
    coast: readData('coast.json'), places: readData('places.json'), localRoads: readData('local-roads.json'),
  };
}

// A fresh graph + algorithms (graphs are mutable, so each test file builds its own).
export function makeWorld(settings = { builtUp: true, avoidReports: true }) {
  const data = loadGraphData();
  const graph = createGraph(data, settings);
  const { ALGS, runDijkstra } = createAlgorithms(graph);
  return { data, graph, ALGS, runDijkstra, settings };
}
