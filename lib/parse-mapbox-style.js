import {visitLayers, visitProperties} from "./visit";
var stylespec = require("@mapbox/mapbox-gl-style-spec");
var style = require("./style.json");
// vt2geojson https://mbtiles.nst.guide/services/openmaptiles/us/tiles/12/666/1433.pbf > openmaptiles-12-666-1433.json
var featureCollection = require("../tests/fixtures/openmaptiles-12-666-1433.json");
var features = featuresArrayToObject(featureCollection.features, 'vt_layer', 'openmaptiles');

var SUPPORTED_PROPERTY_KEYS = {
  line: ["line-color", "line-width", "visibility"]
};

var SUPPORTED_LAYER_TYPES = ["line"];

var MAPBOX_DECK_LAYER_XW = {
  line: "PathLayer"
};

var MAPBOX_DECK_PROPERTY_XW = {
  "line-color": "getColor"
};

// features expected to be
// {sourceName: {layerName: [features]}}
export function parseMapboxStyle(options = {}) {
  var { style, features, zoom } = options;

  var globalProperties = { zoom: zoom };
  var generatedFeatures = {};

  // Loop over layers
  // For each style layer, find all the features that
  // Note that there can be a 1:n mapping of features to style layers
  // I.e. each feature can be styled more than once. Therefore you really need to loop over style
  // layers, not features
  visitLayers(style, layer => {
    // Features relevant to this layer
    var layerFeatures = findFeaturesStyledByLayer(features, layer);
    var layerProperties = [];
    visitProperties(layer, { paint: true }, property =>
      layerProperties.push(property)
    );

    var deckFeatures;
    switch (layer.type) {
      case "line":
        deckFeatures = generateDeckLineFeatures(
          layerFeatures,
          layerProperties,
          globalProperties
        );
        break;
      default:
        console.error("Incorrect layer type");
    }

    // TODO: fix append -> push
    generatedFeatures[layer.type].append(deckFeatures);
  });

  // Convert to binary represenatation for deck.gl
  return finalizeGeneratedFeatures(generatedFeatures);
}

// features expected to be
// {sourceName: {layerName: [features]}}
function findFeaturesStyledByLayer(features, layer) {
  // features matching the source and source-layer
  var sourceLayerFeatures = features[layer.source][layer["source-layer"]];

  if (layer.filter && layer.filter.length > 0) {
    sourceLayerFeatures = filterFeatures(sourceLayerFeatures, layer.filter);
  }

  return sourceLayerFeatures;
}

function filterFeatures(features, filter, globalProperties) {
  // filterFun will be a function that returns a boolean
  var filterFun = stylespec.featureFilter(filter);

  // Filter array of features based on filter function
  return (filteredFeatures = features.filter(feature =>
    filterFun(globalProperties, feature)
  ));
}

// Generate an object consisting of a list of line features that should all be styled the same way
function generateDeckLineFeatures(features, properties, globalProperties) {
  var lineGeometries = [];
  for (var feature of features) {
    var lines = geometryToLines(feature.geometry);
    lines.forEach(x => lineGeometries.push(x.coordinates));
  }

  var deckProperties = {};
  for (var property of properties) {
    var expression = stylespec.expression.normalizePropertyExpression(
      property.value,
      property.reference
    );
    var result = expression.evaluate(globalProperties);
    var deckPropertyKey = MAPBOX_DECK_PROPERTY_XW[property.key];
    if (result instanceof stylespec.Color) {
      deckProperties[deckPropertyKey] = result.toArray();
    }
  }

  return { lines: lineGeometries, properties: deckProperties };
}

// returns array of `LineString` geojson geometries
// This is because some input types, like MultiLineString or MultiPolygon constitute multiple lines
function geometryToLines(geometry) {
  if (geometry.type === "Polygon") {
    return [polygonToLine(geometry).geometry];
  } else if (geometry.type === "MultiPolygon") {
    return polygonToLine(geometry).features.map(f => f.geometry);
  }
}

// TODO: add optional layerNames property, so that you don't have to iterate over features once just
// to get layer names. This also would support creating an object with a known subset of layers.
export function featuresArrayToObject(features, layerProperty, sourceName) {
  // convert list of features into {layer: layer_features}
  var layerNames = Array.from(
    features.reduce(
      (set, feature) => set.add(feature.properties[layerProperty]),
      new Set()
    )
  );
  var featuresByLayer = {};
  layerNames.forEach(layerName => {
    featuresByLayer[layerName] = features.filter(
      feature => feature.properties[layerProperty] === layerName
    );
  });
  return { [sourceName]: featuresByLayer };
}
