#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

// Stable source provenance marker; this is not a secret or an access-control value.
const MODMIND_SOURCE_FINGERPRINT = 'sha256:235b5b247370dc5069a627962c848fb0d80f557114a51f51ebf5610db303f504';

// The desktop application writes bridge.json next to this file for each
// project. MODMIND_BRIDGE_CONFIG is useful for package managers and tests.
const configPath = process.env.MODMIND_BRIDGE_CONFIG
  ? path.resolve(process.env.MODMIND_BRIDGE_CONFIG)
  : path.join(path.dirname(path.resolve(process.argv[1])), 'bridge.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error('bridge.json must contain a valid TCP port');
}
if (typeof config.token !== 'string' || config.token.length < 16) {
  throw new Error('bridge.json must contain a non-empty bridge token');
}

const endpoint = `http://127.0.0.1:${config.port}/tool`;
const readOnlyLocal = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const readOnlyRemote = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const safeStateChange = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const managedAction = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const blockbenchActionsInputSchema = {
  type: 'object', additionalProperties: false, required: ['actions'],
  properties: {
    expectedRevision: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$', description: 'Revision returned by modmind_blockbench_project_state. Include it when editing an existing project.' },
    actions: { type: 'array', minItems: 1, maxItems: 500, items: { $ref: '#/$defs/action' } }
  },
  $defs: {
    vector3: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
    vector2: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
    face: { type: 'string', enum: ['north', 'east', 'south', 'west', 'up', 'down'] },
    meshFace: { type: 'object', additionalProperties: false, required: ['vertices'], properties: { id: { type: 'string' }, vertices: { type: 'array', minItems: 3, maxItems: 64, items: { type: 'string' } }, uv: { type: 'object', additionalProperties: { $ref: '#/$defs/vector2' } }, textureUuid: { type: 'string' }, textureName: { type: 'string' } } },
    action: { oneOf: [
      { type: 'object', additionalProperties: false, required: ['type', 'format', 'name'], properties: { type: { const: 'new-model' }, format: { type: 'string', enum: ['java_block', 'modded_entity', 'bedrock_block', 'bedrock', 'skin', 'free'] }, name: { type: 'string' }, textureWidth: { type: 'integer', minimum: 1, maximum: 1024 }, textureHeight: { type: 'integer', minimum: 1, maximum: 1024 } } },
      { type: 'object', additionalProperties: false, required: ['type', 'name', 'from', 'to'], properties: { type: { const: 'add-cube' }, name: { type: 'string' }, from: { $ref: '#/$defs/vector3' }, to: { $ref: '#/$defs/vector3' }, origin: { $ref: '#/$defs/vector3' }, rotation: { $ref: '#/$defs/vector3' }, inflate: { type: 'number' }, textureUuid: { type: 'string' }, textureName: { type: 'string' }, parentGroupUuid: { type: 'string' }, parentGroupName: { type: 'string' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'name'], properties: { type: { const: 'add-group' }, name: { type: 'string' }, origin: { $ref: '#/$defs/vector3' }, rotation: { $ref: '#/$defs/vector3' }, parentGroupUuid: { type: 'string' }, parentGroupName: { type: 'string' } } },
      { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: 'update-cube' }, cubeUuid: { type: 'string' }, cubeName: { type: 'string' }, from: { $ref: '#/$defs/vector3' }, to: { $ref: '#/$defs/vector3' }, origin: { $ref: '#/$defs/vector3' }, rotation: { $ref: '#/$defs/vector3' }, inflate: { type: 'number' } } },
      { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: 'update-group' }, groupUuid: { type: 'string' }, groupName: { type: 'string' }, origin: { $ref: '#/$defs/vector3' }, rotation: { $ref: '#/$defs/vector3' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'name', 'vertices', 'faces'], properties: { type: { const: 'add-mesh' }, name: { type: 'string' }, vertices: { type: 'object', additionalProperties: { $ref: '#/$defs/vector3' } }, faces: { type: 'array', minItems: 1, maxItems: 8192, items: { $ref: '#/$defs/meshFace' } }, origin: { $ref: '#/$defs/vector3' }, rotation: { $ref: '#/$defs/vector3' }, shading: { type: 'string', enum: ['flat', 'smooth'] }, parentGroupUuid: { type: 'string' }, parentGroupName: { type: 'string' } } },
      { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: 'update-mesh' }, meshUuid: { type: 'string' }, meshName: { type: 'string' }, vertices: { type: 'object', additionalProperties: { $ref: '#/$defs/vector3' } }, faces: { type: 'array', minItems: 1, maxItems: 8192, items: { $ref: '#/$defs/meshFace' } }, origin: { $ref: '#/$defs/vector3' }, rotation: { $ref: '#/$defs/vector3' }, shading: { type: 'string', enum: ['flat', 'smooth'] } } },
      { type: 'object', additionalProperties: false, required: ['type', 'elementUuids'], properties: { type: { const: 'delete-elements' }, elementUuids: { type: 'array', minItems: 1, maxItems: 256, uniqueItems: true, items: { type: 'string' } } } },
      { type: 'object', additionalProperties: false, required: ['type', 'elementUuid', 'name'], properties: { type: { const: 'duplicate-element' }, elementUuid: { type: 'string' }, name: { type: 'string' }, offset: { $ref: '#/$defs/vector3' }, parentGroupUuid: { type: 'string' }, parentGroupName: { type: 'string' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'elementUuid', 'name'], properties: { type: { const: 'rename-element' }, elementUuid: { type: 'string' }, name: { type: 'string' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'elementUuid'], properties: { type: { const: 'reparent-element' }, elementUuid: { type: 'string' }, parentGroupUuid: { type: 'string' }, parentGroupName: { type: 'string' }, root: { type: 'boolean' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'faces'], properties: { type: { const: 'update-cube-faces' }, cubeUuid: { type: 'string' }, cubeName: { type: 'string' }, faces: { type: 'object' } } },
      { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: 'paint-texture' }, textureUuid: { type: 'string' }, textureName: { type: 'string' }, rectangles: { type: 'array', maxItems: 512, items: { type: 'object' } }, strokes: { type: 'array', maxItems: 256, items: { type: 'object' } }, paletteMap: { type: 'object' } } },
      { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: 'auto-unwrap-mesh' }, meshUuid: { type: 'string' }, meshName: { type: 'string' }, textureWidth: { type: 'integer', minimum: 1, maximum: 1024 }, textureHeight: { type: 'integer', minimum: 1, maximum: 1024 }, padding: { type: 'number', minimum: 0, maximum: 64 } } },
      { type: 'object', additionalProperties: false, required: ['type', 'name'], properties: { type: { const: 'add-armature' }, name: { type: 'string' }, origin: { $ref: '#/$defs/vector3' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'name'], properties: { type: { const: 'add-bone' }, name: { type: 'string' }, armatureUuid: { type: 'string' }, armatureName: { type: 'string' }, parentBoneUuid: { type: 'string' }, parentBoneName: { type: 'string' }, origin: { $ref: '#/$defs/vector3' }, rotation: { $ref: '#/$defs/vector3' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'weights'], properties: { type: { const: 'set-vertex-weights' }, meshUuid: { type: 'string' }, meshName: { type: 'string' }, weights: { type: 'object' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'name', 'position'], properties: { type: { const: 'add-locator' }, name: { type: 'string' }, position: { $ref: '#/$defs/vector3' }, parentGroupUuid: { type: 'string' }, parentGroupName: { type: 'string' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'name', 'position'], properties: { type: { const: 'add-ik-target' }, name: { type: 'string' }, position: { $ref: '#/$defs/vector3' }, targetGroupUuid: { type: 'string' }, targetGroupName: { type: 'string' }, sourceGroupUuid: { type: 'string' }, sourceGroupName: { type: 'string' }, lockRotation: { type: 'boolean' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'name', 'length'], properties: { type: { const: 'add-animation' }, name: { type: 'string' }, length: { type: 'number', exclusiveMinimum: 0 }, loop: { type: 'string', enum: ['once', 'loop', 'hold'] }, snapping: { type: 'integer', minimum: 1, maximum: 120 } } },
      { type: 'object', additionalProperties: false, required: ['type', 'channel', 'time', 'value'], properties: { type: { const: 'add-keyframe' }, animationUuid: { type: 'string' }, animationName: { type: 'string' }, groupUuid: { type: 'string' }, groupName: { type: 'string' }, channel: { type: 'string', enum: ['rotation', 'position', 'scale'] }, time: { type: 'number', minimum: 0 }, value: { $ref: '#/$defs/vector3' }, interpolation: { type: 'string', enum: ['linear', 'catmullrom', 'step', 'bezier'] } } },
      { type: 'object', additionalProperties: false, required: ['type', 'name', 'width', 'height'], properties: { type: { const: 'create-texture' }, name: { type: 'string' }, width: { type: 'integer', minimum: 1, maximum: 1024 }, height: { type: 'integer', minimum: 1, maximum: 1024 }, dataUrl: { type: 'string' }, fill: { type: 'string' }, rectangles: { type: 'array', maxItems: 256, items: { type: 'object', additionalProperties: false, required: ['x', 'y', 'width', 'height', 'color'], properties: { x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 }, width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 }, color: { type: 'string' } } } } } },
      { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: 'set-cube-texture' }, cubeUuid: { type: 'string' }, cubeName: { type: 'string' }, textureUuid: { type: 'string' }, textureName: { type: 'string' }, faces: { type: 'array', maxItems: 6, items: { $ref: '#/$defs/face' } } } },
      { type: 'object', additionalProperties: false, required: ['type', 'relativePath'], properties: { type: { const: 'save-project' }, relativePath: { type: 'string' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'relativePath'], properties: { type: { const: 'export-model' }, relativePath: { type: 'string' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'relativePath'], properties: { type: { const: 'save-texture' }, relativePath: { type: 'string' }, textureUuid: { type: 'string' }, textureName: { type: 'string' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'command'], properties: { type: { const: 'run-command' }, command: { type: 'string', enum: ['undo', 'redo', 'frame-all', 'toggle-grid', 'toggle-animate', 'mode-edit', 'mode-paint', 'mode-animate', 'open-project', 'save-project-dialog'] } } }
    ] }
  }
};
const assetAnimationSchema = {
  type: 'object', additionalProperties: false, required: ['name', 'length', 'tracks'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 64 }, length: { type: 'number', exclusiveMinimum: 0, maximum: 3600 }, loop: { type: 'string', enum: ['once', 'loop', 'hold'] },
    tracks: { type: 'array', maxItems: 120, items: { type: 'object', additionalProperties: false, required: ['part', 'channel', 'keyframes'], properties: {
      part: { type: 'string', minLength: 1, maxLength: 64 }, channel: { type: 'string', enum: ['rotation', 'position', 'scale'] },
      keyframes: { type: 'array', maxItems: 120, items: { type: 'object', additionalProperties: false, required: ['time', 'value'], properties: {
        time: { type: 'number', minimum: 0, maximum: 3600 }, value: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }, interpolation: { type: 'string', enum: ['linear', 'catmullrom', 'step', 'bezier'] }
      } } }
    } } }
  }
};
const assetIntentProgramSchema = {
  type:'object', additionalProperties:false, required:['version','metadata','model'],
  properties:{
    version:{const:1},
    metadata:{type:'object',additionalProperties:false,required:['name'],properties:{name:{type:'string',minLength:1,maxLength:64},quality:{type:'string',enum:['essential','hero']},domain:{type:'string',enum:['organism','item','block','mechanism']}}},
    model:{type:'object',additionalProperties:false,required:['format','parts'],properties:{
      format:{type:'string',enum:['java_block','modded_entity','bedrock_block','bedrock','free']},
      textureWidth:{type:'integer',minimum:1,maximum:1024}, textureHeight:{type:'integer',minimum:1,maximum:1024},
      symmetry:{type:'string',enum:['bilateral','asymmetric']},
      parts:{type:'array',minItems:1,maxItems:64,items:{type:'object',additionalProperties:false,required:['id','kind','size'],properties:{
        id:{type:'string',minLength:1,maxLength:64}, kind:{type:'string',enum:['body','head','limb','tail','wing','fin','detail']},
        parent:{type:'string',maxLength:64}, side:{type:'string',enum:['center','left','right']},
        size:{type:'array',minItems:3,maxItems:3,items:{type:'number'}}, offset:{type:'array',minItems:3,maxItems:3,items:{type:'number'}},
        rotation:{type:'array',minItems:3,maxItems:3,items:{type:'number'}}, inflate:{type:'number'}
      }}}
    }},
    appearance:{type:'object',additionalProperties:false,properties:{palette:{type:'string',enum:['natural','ember','ocean','noir','metal','gold']},texture:{type:'string',enum:['quiet','mottle','grain','brushed','weathered']},seed:{type:'string',maxLength:128}}},
    animation: assetAnimationSchema
  }
};
const assetRefinementProgramSchema = {
  type: 'object', additionalProperties: false, required: ['version', 'metadata', 'parts'],
  properties: {
    version: { const: 1 },
    metadata: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 64 }, sourceIntentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' } } },
    parts: { type: 'array', maxItems: 64, items: { type: 'object', additionalProperties: false, required: ['id'], properties: {
      id: { type: 'string', minLength: 1, maxLength: 64 }, size: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
      offset: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }, rotation: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }, inflate: { type: 'number' }
    } } },
    animation: assetAnimationSchema
  }
};
const advancedAssetProgramSchema = {
  type: 'object', additionalProperties: false, required: ['version', 'metadata', 'model'],
  properties: {
    version: { const: 1 },
    metadata: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 64 }, quality: { type: 'string', enum: ['draft', 'production', 'hero'] }, symmetry: { type: 'string', enum: ['bilateral', 'asymmetric'] } } },
    model: { type: 'object', additionalProperties: false, required: ['primitives'], properties: {
      format: { type: 'string', enum: ['java_block', 'modded_entity', 'bedrock_block', 'bedrock', 'skin', 'free'] }, textureWidth: { type: 'integer', minimum: 1, maximum: 1024 }, textureHeight: { type: 'integer', minimum: 1, maximum: 1024 },
      primitives: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'object', required: ['id', 'type'], properties: {
        id: { type: 'string', minLength: 1, maxLength: 64 }, type: { type: 'string', enum: ['cube', 'wedge', 'cylinder', 'sphere', 'extrude', 'tube'] }, center: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }, rotation: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }, parent: { type: 'string' }, shading: { type: 'string', enum: ['flat', 'smooth'] }, size: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }, inflate: { type: 'number' }, radius: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 }, segments: { type: 'integer', minimum: 3, maximum: 64 }, rings: { type: 'integer', minimum: 2, maximum: 32 }, profile: { type: 'array', minItems: 3, maxItems: 128, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } }, depth: { type: 'number', exclusiveMinimum: 0 }, path: { type: 'array', minItems: 2, maxItems: 64, items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } } }, radialSegments: { type: 'integer', minimum: 3, maximum: 32 }, curveSegments: { type: 'integer', minimum: 1, maximum: 16 }, closed: { type: 'boolean' }
      } } }
    } },
    texture: { type: 'object', properties: { name: { type: 'string' }, width: { type: 'integer', minimum: 1, maximum: 1024 }, height: { type: 'integer', minimum: 1, maximum: 1024 }, fill: { type: 'string' }, rectangles: { type: 'array', maxItems: 512, items: { type: 'object' } }, strokes: { type: 'array', maxItems: 256, items: { type: 'object' } } } },
    rig: { type: 'object', required: ['name', 'bones'], properties: { name: { type: 'string' }, bones: { type: 'array', maxItems: 128, items: { type: 'object' } }, weights: { type: 'object' }, weightRules: { type: 'array', maxItems: 128, items: { type: 'object' } }, locators: { type: 'array', maxItems: 128, items: { type: 'object' } }, ik: { type: 'array', maxItems: 64, items: { type: 'object' } } } },
    animations: { type: 'array', maxItems: 32, items: { type: 'object' } }, variants: { type: 'array', maxItems: 2, items: { type: 'object' } }
  }
};
const referenceAssetProgramSchema = {
  type: 'object', additionalProperties: false, required: ['version', 'metadata', 'image'], properties: {
    version: { const: 1 }, metadata: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 64 }, quality: { type: 'string', enum: ['draft', 'production', 'hero'] } } },
    image: { type: 'object', additionalProperties: false, required: ['dataUrl'], properties: { dataUrl: { type: 'string', maxLength: 11184832 }, depth: { type: 'number', exclusiveMinimum: 0, maximum: 256 }, alphaThreshold: { type: 'number', minimum: 0, maximum: 255 }, simplify: { type: 'number' }, maxProfilePoints: { type: 'integer', minimum: 8, maximum: 128 } } },
    model: { type: 'object', additionalProperties: false, properties: { format: { type: 'string', enum: ['java_block', 'modded_entity', 'bedrock_block', 'bedrock', 'skin', 'free'] }, textureWidth: { type: 'integer', minimum: 1, maximum: 1024 }, textureHeight: { type: 'integer', minimum: 1, maximum: 1024 } } }, rig: { type: 'object' }, animations: { type: 'array' }
  }
};

async function callTool(action, input) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-modmind-token': config.token },
    body: JSON.stringify({ action, input: input || {} })
  });
  const body = await response.text();
  if (!response.ok) throw new Error(body || `ModMind tool failed: ${response.status}`);
  return JSON.parse(body);
}

// --- User plugin tools -----------------------------------------------------
// The desktop app can host user-created plugins that register extra tools.
// The bridge exposes them through the `plugin_tools` / `plugin_tool_call`
// actions. Older bridges do not know these actions: every plugin lookup must
// therefore degrade gracefully back to the built-in static list.

const PLUGIN_TOOL_NAME_PATTERN = /^modmind_plugin_[a-z0-9][a-z0-9-]{1,62}[a-z0-9]_[a-z0-9][a-z0-9_-]{1,48}$/;

function pluginDescriptorToMcp(descriptor) {
  const annotations = descriptor.annotations && typeof descriptor.annotations === 'object' ? descriptor.annotations : {};
  const mcpAnnotations = {};
  if ('readOnlyLocal' in annotations || 'readOnlyRemote' in annotations) {
    const readOnly = Boolean(annotations.readOnlyLocal || annotations.readOnlyRemote);
    mcpAnnotations.readOnlyHint = readOnly;
    mcpAnnotations.destructiveHint = false;
    mcpAnnotations.idempotentHint = true;
    mcpAnnotations.openWorldHint = annotations.readOnlyRemote === true;
  }
  if ('safeStateChange' in annotations && !mcpAnnotations.readOnlyHint) {
    mcpAnnotations.readOnlyHint = false;
    mcpAnnotations.destructiveHint = false;
    mcpAnnotations.idempotentHint = true;
    mcpAnnotations.openWorldHint = false;
  }
  if ('managedAction' in annotations && !mcpAnnotations.readOnlyHint) {
    mcpAnnotations.readOnlyHint = false;
    mcpAnnotations.destructiveHint = false;
    mcpAnnotations.idempotentHint = false;
    mcpAnnotations.openWorldHint = true;
  }
  return {
    name: descriptor.name,
    description: descriptor.description,
    ...(descriptor.inputSchema ? { inputSchema: descriptor.inputSchema } : { inputSchema: { type: 'object', properties: {} } }),
    ...(Object.keys(mcpAnnotations).length ? { annotations: mcpAnnotations } : {})
  };
}

async function fetchPluginTools() {
  try {
    const value = await Promise.race([
      callTool('plugin_tools', {}),
      new Promise((resolve, reject) => setTimeout(() => reject(new Error('plugin_tools timed out')), 5000))
    ]);
    const descriptors = Array.isArray(value?.tools) ? value.tools : [];
    return descriptors
      .filter((descriptor) => descriptor && typeof descriptor.name === 'string' && PLUGIN_TOOL_NAME_PATTERN.test(descriptor.name))
      .map(pluginDescriptorToMcp);
  } catch {
    return [];
  }
}

async function isPluginToolName(name) {
  if (!PLUGIN_TOOL_NAME_PATTERN.test(name)) return false;
  const pluginTools = await fetchPluginTools();
  return pluginTools.some((tool) => tool.name === name);
}

const tools = [
  { name: 'modmind_project_info', description: 'Read active ModMind project metadata and integration rules.', inputSchema: { type: 'object', properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_project_files', description: 'List project-relative files through ModMind without invoking a shell directory command. This is read-only and excludes tool data, build output, and VCS metadata.', inputSchema: { type: 'object', properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_rename_project', description: 'Rename the active project and migrate project-owned namespace references. Use only when explicitly requested.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, namespace: { type: 'string' } }, required: ['name', 'namespace'] }, annotations: managedAction },
  { name: 'modmind_set_intent', description: 'Label the current task as engineering or informational.', inputSchema: { type: 'object', properties: { intent: { type: 'string', enum: ['engineering', 'informational'] }, reason: { type: 'string' } }, required: ['intent', 'reason'] }, annotations: safeStateChange },
  { name: 'modmind_apply_edits', description: 'Apply exact project-relative text edits. Existing files require oldText to match exactly once.', inputSchema: { type: 'object', properties: { edits: { type: 'array', minItems: 1, items: { type: 'object', properties: { path: { type: 'string' }, purpose: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'newText'] } } }, required: ['edits'] }, annotations: managedAction },
  { name: 'modmind_update_todo', description: 'Publish a task list to the ModMind progress UI.', inputSchema: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } }, required: ['id', 'title', 'status'] } } }, required: ['tasks'] }, annotations: safeStateChange },
  { name: 'modmind_mapping_search', description: 'Search mappings.dev for the active Minecraft version.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] }, annotations: readOnlyRemote },
  { name: 'modmind_mapping_class', description: 'Inspect an exact mapped Minecraft class and optional member query.', inputSchema: { type: 'object', properties: { className: { type: 'string' }, memberQuery: { type: 'string' } }, required: ['className'] }, annotations: readOnlyRemote },
  { name: 'modmind_dependency_search', description: 'Search Modrinth for projects compatible with the active loader and Minecraft version.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, offset: { type: 'number' } }, required: ['query'] }, annotations: readOnlyRemote },
  { name: 'modmind_dependency_install', description: 'Install a compatible Modrinth dependency through managed Gradle integration.', inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, versionId: { type: 'string' } }, required: ['projectId'] }, annotations: managedAction },
  { name: 'modmind_maven_dependency_install', description: 'Register a Maven dependency through ModMind managed Gradle blocks. Use this instead of editing Gradle dependency or repository blocks directly when the requested library is available from Maven.', inputSchema: { type: 'object', properties: { coordinate: { type: 'string' }, repository: { type: 'string' }, configuration: { type: 'string', enum: ['implementation', 'modImplementation', 'compileOnly', 'runtimeOnly'] } }, required: ['coordinate'] }, annotations: managedAction },
  { name: 'modmind_addon_relationships', description: 'Read prepared add-on targets, exact versions, artifact/source paths, public package summaries, and license constraints.', inputSchema: { type: 'object', properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_addon_prepare', description: 'Prepare one or more add-on target mods by exact name. Resolves compatible Modrinth/CurseForge projects and required transitive dependencies, downloads and verifies runtime JARs, obtains exact-version sources when available, updates Gradle and loader metadata, and synchronizes the test instance. Use this before implementing a request to extend another mod.', inputSchema: { type: 'object', properties: { required: { type: 'array', items: { type: 'string' } }, optional: { type: 'array', items: { type: 'string' } }, providers: { type: 'array', items: { type: 'string', enum: ['modrinth', 'curseforge'] } } }, required: [] }, annotations: managedAction },
  { name: 'modmind_addon_import', description: 'Import project-relative JAR files as add-on targets only when their hashes identify exact platform files. Ambiguous files are rejected for batch confirmation in the UI.', inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } }, role: { type: 'string', enum: ['required', 'optional', 'test'] } }, required: ['paths'] }, annotations: managedAction },
  { name: 'modmind_addon_link_project', description: 'Build and link another existing ModMind Java mod project as a required add-on target. The path must point to a ModMind project with the same Minecraft version and Loader.', inputSchema: { type: 'object', properties: { projectPath: { type: 'string' } }, required: ['projectPath'] }, annotations: managedAction },
  { name: 'modmind_validate_content', description: 'Validate project JSON, OGG headers, and sound references without changing files.', inputSchema: { type: 'object', properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_test_matrix', description: 'Run selected managed build, client, server, or GameTest targets.', inputSchema: { type: 'object', properties: { targets: { type: 'array', items: { type: 'string', enum: ['build', 'client', 'server', 'gametest'] } } }, required: ['targets'] }, annotations: managedAction },
  { name: 'modmind_release_preflight', description: 'Inspect release artifact, metadata, license, version, and changelog readiness.', inputSchema: { type: 'object', properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_build_project', description: 'Run the managed Gradle build and return the artifact or diagnostics.', inputSchema: { type: 'object', properties: {} }, annotations: managedAction },
  { name: 'modmind_test_minecraft', description: 'Build and launch the isolated Minecraft test instance and return startup evidence.', inputSchema: { type: 'object', properties: {} }, annotations: managedAction },
  { name: 'modmind_modpack_plan', description: 'Resolve a modpack concept into compatible candidates and return conflicts without downloading.', inputSchema: { type: 'object', properties: { required: { type: 'array', items: { type: 'string' } }, optional: { type: 'array', items: { type: 'string' } }, excluded: { type: 'array', items: { type: 'string' } }, providers: { type: 'array', items: { type: 'string', enum: ['modrinth', 'curseforge'] } }, maxMods: { type: 'number' } }, required: ['required'] }, annotations: managedAction },
  { name: 'modmind_modpack_apply_plan', description: 'Download and hash-lock every resolved mod in a validated modpack plan.', inputSchema: { type: 'object', properties: { plan: { type: 'object' } }, required: ['plan'] }, annotations: managedAction },
  { name: 'modmind_modpack_migration_targets', description: 'List supported Minecraft and Loader targets for migrating the active modpack.', inputSchema: { type: 'object', properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_modpack_migration_preview', description: 'Scan the active modpack against a target and return official files, replacements, source ports, missing or unknown mods, MC百科 evidence, custom content, and source JAR dossiers without changing the project.', inputSchema: { type: 'object', properties: { loader: { type: 'string', enum: ['fabric', 'quilt', 'forge', 'neoforge'] }, minecraftVersion: { type: 'string' } }, required: ['loader', 'minecraftVersion'] }, annotations: readOnlyRemote },
  { name: 'modmind_modpack_migration_apply', description: 'Apply migration decisions in the original project directory. Defaults to backup mode and permits deferred unresolved mods. Mod actions: use-compatible, use-replacement, manual-file, create-compat-module, remove, or defer.', inputSchema: { type: 'object', properties: { loader: { type: 'string', enum: ['fabric', 'quilt', 'forge', 'neoforge'] }, minecraftVersion: { type: 'string' }, mode: { type: 'string', enum: ['backup', 'direct'] }, mods: { type: 'array', items: { type: 'object' } }, modules: { type: 'array', items: { type: 'object' } }, content: { type: 'array', items: { type: 'object' } } }, required: ['loader', 'minecraftVersion', 'mods', 'modules', 'content'] }, annotations: managedAction },
  { name: 'modmind_modpack_migration_history', description: 'Read migration records, incomplete results, reports, backup availability, and undo state.', inputSchema: { type: 'object', properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_modpack_migration_undo', description: 'Undo a backup-mode migration. ModMind always snapshots the current post-migration state before restoring the source snapshot.', inputSchema: { type: 'object', properties: { migrationId: { type: 'string' } }, required: ['migrationId'] }, annotations: managedAction },
  { name: 'modmind_modpack_download_content', description: 'Download arbitrary HTTPS modpack content through ModMind verified download, size limits, hashing, inventory tracking, and safe world extraction. Covers config, scripts, datapacks, quests, resource packs, shader packs, UI files, worlds, client/server files, and other pack content.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['config', 'scripts', 'datapacks', 'quests', 'resourcepacks', 'shaderpacks', 'ui', 'worlds', 'client', 'server', 'other'] }, scope: { type: 'string', enum: ['common', 'client', 'server'] }, url: { type: 'string' }, targetPath: { type: 'string' }, extract: { type: 'boolean' } }, required: ['kind', 'url'] }, annotations: managedAction },
  { name: 'modmind_mcmod_search', description: 'Query MC百科 metadata when Modrinth and CurseForge have no compatible replacement. Read-only.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] }, annotations: readOnlyRemote },
  { name: 'modmind_mcmod_files', description: 'List public MC百科 file metadata for a numeric project ID. No download actions.', inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] }, annotations: readOnlyRemote },
  { name: 'modmind_modpack_write_ftb_quest', description: 'Write a validated FTB Quests chapter as SNBT into pack overrides.', inputSchema: { type: 'object', properties: { chapterId: { type: 'string' }, title: { type: 'string' }, filename: { type: 'string' }, quests: { type: 'array' } }, required: ['chapterId', 'title', 'quests'] }, annotations: managedAction },
  { name: 'modmind_modpack_write_patchouli_book', description: 'Write a validated Patchouli book, categories, entries, and pages into pack overrides.', inputSchema: { type: 'object', properties: { bookId: { type: 'string' }, name: { type: 'string' }, landingText: { type: 'string' }, categories: { type: 'array' } }, required: ['bookId', 'name', 'landingText', 'categories'] }, annotations: managedAction },
  { name: 'modmind_modpack_apply_keybinds', description: 'Apply a keybind preset to options.txt and reject conflicts by default.', inputSchema: { type: 'object', properties: { preset: { type: 'object' }, allowConflicts: { type: 'boolean' } }, required: ['preset'] }, annotations: managedAction },
  { name: 'modmind_modpack_build_server', description: 'Deterministically build the initial server pack with the pinned ServerPackCreator CLI.', inputSchema: { type: 'object', properties: { outputDirectory: { type: 'string' }, port: { type: 'number' }, acceptEula: { type: 'boolean' } } }, annotations: managedAction },
  { name: 'modmind_modpack_verify_server_join', description: 'Build a loopback-only local server and verify a HeadlessMC client joins with evidence.', inputSchema: { type: 'object', properties: { outputDirectory: { type: 'string' }, port: { type: 'number' }, acceptEula: { type: 'boolean' }, onlineMode: { type: 'boolean' } } }, annotations: managedAction },
  { name: 'modmind_modpack_apply_optimization_profile', description: 'Install a conservative optimization profile and apply declared configuration patches.', inputSchema: { type: 'object', properties: { profileId: { type: 'string' }, profile: { type: 'object' } } }, annotations: managedAction },
  { name: 'modmind_modpack_run_server_scenario', description: 'Start a bounded loopback-only server scenario and assert log evidence.', inputSchema: { type: 'object', properties: { steps: { type: 'array' }, outputDirectory: { type: 'string' }, port: { type: 'number' }, acceptEula: { type: 'boolean' }, onlineMode: { type: 'boolean' } }, required: ['steps'] }, annotations: managedAction },
  { name: 'modmind_blockbench_project_state', description: 'Read the complete live Blockbench project structure and content revision before editing.', inputSchema: { type: 'object', additionalProperties: false, properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_blockbench_validate', description: 'Validate the live Blockbench project structure, textures, and animation references.', inputSchema: { type: 'object', additionalProperties: false, properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_blockbench_capture_views', description: 'Render 1-6 model-only PNG views and return them as MCP image content.', inputSchema: { type: 'object', additionalProperties: false, properties: { views: { type: 'array', minItems: 1, maxItems: 6, uniqueItems: true, items: { type: 'string', enum: ['initial', 'top', 'bottom', 'south', 'north', 'east', 'west', 'isometric_right', 'isometric_left', 'true_isometric_right', 'true_isometric_left'] } }, width: { type: 'integer', minimum: 128, maximum: 1024 }, height: { type: 'integer', minimum: 128, maximum: 1024 } } }, annotations: readOnlyLocal },
  { name: 'modmind_blockbench_actions', description: 'Execute a validated Blockbench batch. Inspect first and pass expectedRevision when editing an existing project.', inputSchema: blockbenchActionsInputSchema, annotations: managedAction },
  { name: 'modmind_blockbench_history', description: 'List the last 20 restorable Blockbench checkpoints.', inputSchema: { type: 'object', additionalProperties: false, properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_blockbench_checkpoint', description: 'Create a named checkpoint of the complete editable Blockbench project.', inputSchema: { type: 'object', additionalProperties: false, properties: { label: { type: 'string', maxLength: 100 } } }, annotations: safeStateChange },
  { name: 'modmind_blockbench_restore_history', description: 'Restore one checkpoint and retain the current state as a new checkpoint.', inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } }, annotations: managedAction },
  { name: 'modmind_asset_compile_intent', description: 'Compile an Ashfox-style Asset Intent Program into a deterministic Blockbench candidate without changing the open project.', inputSchema: assetIntentProgramSchema, annotations: readOnlyLocal },
  { name: 'modmind_asset_preview_intent', description: 'Build an Asset Intent candidate in a temporary Blockbench tab, validate and capture it for visual review, then discard it and restore the original project.', inputSchema: { type:'object', additionalProperties:false, required:['intent'], properties:{ expectedRevision:{type:'string',pattern:'^sha256:[a-f0-9]{64}$'}, capture:{type:'object',additionalProperties:false,properties:{views:{type:'array',minItems:1,maxItems:6,uniqueItems:true,items:{type:'string',enum:['initial','top','bottom','south','north','east','west','isometric_right','isometric_left','true_isometric_right','true_isometric_left']}},width:{type:'integer',minimum:128,maximum:1024},height:{type:'integer',minimum:128,maximum:1024}}}, intent:assetIntentProgramSchema } }, annotations: readOnlyLocal },
  { name: 'modmind_asset_apply_intent', description: 'Compile and apply an Ashfox-style Asset Intent Program as one validated Blockbench batch. Pass expectedRevision when replacing or editing an existing project.', inputSchema: { type:'object', additionalProperties:false, required:['intent'], properties:{ expectedRevision:{type:'string',pattern:'^sha256:[a-f0-9]{64}$'}, intent:assetIntentProgramSchema } }, annotations: managedAction },
  { name: 'modmind_asset_compile_refinement', description: 'Compile a structured refinement against the current Blockbench project without changing it.', inputSchema: assetRefinementProgramSchema, annotations: readOnlyLocal },
  { name: 'modmind_asset_preview_refinement', description: 'Clone the current Blockbench project, apply a structured refinement to the clone, validate and capture it, then discard the clone.', inputSchema: { type: 'object', additionalProperties: false, required: ['refinement'], properties: { expectedRevision: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, capture: { type: 'object', additionalProperties: false, properties: { views: { type: 'array', minItems: 1, maxItems: 6, uniqueItems: true, items: { type: 'string', enum: ['initial', 'top', 'bottom', 'south', 'north', 'east', 'west', 'isometric_right', 'isometric_left', 'true_isometric_right', 'true_isometric_left'] } }, width: { type: 'integer', minimum: 128, maximum: 1024 }, height: { type: 'integer', minimum: 128, maximum: 1024 } } }, refinement: assetRefinementProgramSchema } }, annotations: readOnlyLocal },
  { name: 'modmind_asset_apply_refinement', description: 'Compile and transactionally apply a structured refinement to the current Blockbench project.', inputSchema: { type: 'object', additionalProperties: false, required: ['refinement'], properties: { expectedRevision: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, refinement: assetRefinementProgramSchema } }, annotations: managedAction },
  { name: 'modmind_asset_compile_advanced', description: 'Compile editable primitives, curves, UVs, armatures, weights, IK, animation, and A/B/C variants.', inputSchema: { type: 'object', additionalProperties: false, required: ['program'], properties: { variantId: { type: 'string' }, program: advancedAssetProgramSchema } }, annotations: readOnlyLocal },
  { name: 'modmind_asset_preview_advanced', description: 'Render and visually score A/B/C candidates with up to three bounded correction rounds.', inputSchema: { type: 'object', additionalProperties: false, required: ['program'], properties: { expectedRevision: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, capture: { type: 'object' }, options: { type: 'object', properties: { maxIterations: { type: 'integer', minimum: 1, maximum: 3 }, targetScore: { type: 'number', minimum: 0, maximum: 100 } } }, program: advancedAssetProgramSchema } }, annotations: readOnlyLocal },
  { name: 'modmind_asset_apply_advanced', description: 'Apply one selected advanced editable candidate.', inputSchema: { type: 'object', additionalProperties: false, required: ['program'], properties: { variantId: { type: 'string' }, expectedRevision: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, program: advancedAssetProgramSchema } }, annotations: managedAction },
  { name: 'modmind_asset_compile_reference', description: 'Extract a reference image silhouette and palette into an editable extruded Mesh.', inputSchema: referenceAssetProgramSchema, annotations: readOnlyLocal },
  { name: 'modmind_asset_preview_reference', description: 'Build, validate, render, and visually score a reference-image Mesh candidate.', inputSchema: { type: 'object', additionalProperties: false, required: ['program'], properties: { expectedRevision: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, capture: { type: 'object' }, program: referenceAssetProgramSchema } }, annotations: readOnlyLocal },
  { name: 'modmind_asset_apply_reference', description: 'Apply a reference silhouette as a native editable Blockbench Mesh.', inputSchema: { type: 'object', additionalProperties: false, required: ['program'], properties: { expectedRevision: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, program: referenceAssetProgramSchema } }, annotations: managedAction },
  { name: 'modmind_asset_visual_review', description: 'Score current model framing, contrast, detail, symmetry, clipping, and view consistency.', inputSchema: { type: 'object', additionalProperties: false, properties: { views: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } }, width: { type: 'integer', minimum: 128, maximum: 1024 }, height: { type: 'integer', minimum: 128, maximum: 1024 } } }, annotations: readOnlyLocal },
  { name: 'modmind_runtime_state', description: 'Read the isolated Minecraft test runtime state and recent events.', inputSchema: { type: 'object', properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_scan_java_homes', description: 'Scan this machine for installed Java runtimes and return each home with its major version. Use the homes with modmind_set_app_setting javaPreferences (game/build/tools) or leave empty for ModMind automatic management.', inputSchema: { type: 'object', additionalProperties: false, properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_probe_java_home', description: 'Validate one Java home (or bin/java path) and report {valid, major}. Read-only; runs java -version under the hood.', inputSchema: { type: 'object', additionalProperties: false, required: ['home'], properties: { home: { type: 'string', minLength: 1 } } }, annotations: readOnlyLocal },
  { name: 'modmind_get_app_settings', description: 'Read ModMind application settings including javaPreferences (game/build/tools Java homes; empty means automatic) and gradleDownloadSource.', inputSchema: { type: 'object', additionalProperties: false, properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_set_app_setting', description: 'Update one ModMind application setting. key javaPreferences takes value {game,build,tools} Java home paths (empty restores automatic; unusable versions fall back to managed runtimes). Other keys: darkMode, notificationsEnabled, allowBuildScriptChanges, preferLocalGradle (boolean), closeBehavior, gradleDownloadSource.', inputSchema: { type: 'object', additionalProperties: false, required: ['key'], properties: { key: { type: 'string', enum: ['javaPreferences', 'darkMode', 'notificationsEnabled', 'allowBuildScriptChanges', 'preferLocalGradle', 'closeBehavior', 'gradleDownloadSource'] }, value: {} } }, annotations: managedAction },
  { name: 'modmind_image_generate', description: 'Generate a project image through the configured ModMind Image Studio service.', inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, style: { type: 'string', enum: ['minecraft', 'free'] }, size: { type: 'string' }, quality: { type: 'string', enum: ['low', 'medium', 'high', 'auto'] }, moderation: { type: 'string', enum: ['auto', 'low'] }, count: { type: 'number' }, backgroundColor: { type: 'string' }, referenceImage: { type: 'string' } }, required: ['prompt'] }, annotations: managedAction },
  { name: 'modmind_image_perfect_pixel', description: 'Run pixel-art refinement on an image data URL.', inputSchema: { type: 'object', properties: { dataUrl: { type: 'string' } }, required: ['dataUrl'] }, annotations: managedAction },
  { name: 'modmind_image_remove_background', description: 'Remove an image background with the configured local model.', inputSchema: { type: 'object', properties: { dataUrl: { type: 'string' } }, required: ['dataUrl'] }, annotations: managedAction },
  { name: 'modmind_image_project_assets', description: 'List project image resources usable as reference images.', inputSchema: { type: 'object', properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_image_read_project_asset', description: 'Read one project image resource as a data URL.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, annotations: readOnlyLocal },
  { name: 'modmind_plugins_scaffold', description: 'Create a ModMind plugin scaffold in the global plugin directory.', inputSchema: { type: 'object', additionalProperties: false, required: ['kind', 'id', 'name'], properties: { kind: { type: 'string', enum: ['panel-only', 'tools-only', 'panel-and-tools'] }, id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, author: { type: 'string' }, tools: { type: 'array', items: { type: 'object' } } } }, annotations: managedAction },
  { name: 'modmind_plugins_read_source', description: 'Read the source files of one installed ModMind plugin.', inputSchema: { type: 'object', additionalProperties: false, required: ['pluginId'], properties: { pluginId: { type: 'string' } } }, annotations: readOnlyLocal },
  { name: 'modmind_plugins_write_files', description: 'Write text files inside one installed ModMind plugin directory.', inputSchema: { type: 'object', additionalProperties: false, required: ['pluginId', 'files'], properties: { pluginId: { type: 'string' }, files: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } } } } }, annotations: managedAction },
  { name: 'modmind_plugins_reload', description: 'Rescan plugins and restart loaded plugin backends and panels.', inputSchema: { type: 'object', additionalProperties: false, properties: {} }, annotations: safeStateChange }
];

const actions = {
  modmind_project_info: 'project_info',
  modmind_project_files: 'project_files',
  modmind_rename_project: 'rename_project',
  modmind_set_intent: 'set_intent',
  modmind_apply_edits: 'apply_edits',
  modmind_update_todo: 'update_todo',
  modmind_mapping_search: 'mappings_search',
  modmind_mapping_class: 'mappings_class',
  modmind_dependency_search: 'dependency_search',
  modmind_dependency_install: 'dependency_install',
  modmind_maven_dependency_install: 'maven_dependency_install',
  modmind_addon_relationships: 'addon_relationships',
  modmind_addon_prepare: 'addon_prepare',
  modmind_addon_import: 'addon_import',
  modmind_addon_link_project: 'addon_link_project',
  modmind_validate_content: 'content_validate',
  modmind_test_matrix: 'test_matrix',
  modmind_release_preflight: 'release_preflight',
  modmind_build_project: 'build_project',
  modmind_test_minecraft: 'test_minecraft',
  modmind_modpack_plan: 'modpack_plan',
  modmind_modpack_apply_plan: 'modpack_apply_plan',
  modmind_modpack_migration_targets: 'modpack_migration_targets',
  modmind_modpack_migration_preview: 'modpack_migration_preview',
  modmind_modpack_migration_apply: 'modpack_migration_apply',
  modmind_modpack_migration_history: 'modpack_migration_history',
  modmind_modpack_migration_undo: 'modpack_migration_undo',
  modmind_modpack_download_content: 'modpack_download_content',
  modmind_mcmod_search: 'mcmod_search',
  modmind_mcmod_files: 'mcmod_files',
  modmind_modpack_write_ftb_quest: 'modpack_write_ftb_quest',
  modmind_modpack_write_patchouli_book: 'modpack_write_patchouli_book',
  modmind_modpack_apply_keybinds: 'modpack_apply_keybinds',
  modmind_modpack_build_server: 'modpack_build_server',
  modmind_modpack_verify_server_join: 'modpack_verify_server_join',
  modmind_modpack_apply_optimization_profile: 'modpack_apply_optimization_profile',
  modmind_modpack_run_server_scenario: 'modpack_run_server_scenario',
  modmind_blockbench_project_state: 'blockbench_project_state',
  modmind_blockbench_validate: 'blockbench_validate',
  modmind_blockbench_capture_views: 'blockbench_capture_views',
  modmind_blockbench_actions: 'blockbench_actions',
  modmind_blockbench_history: 'blockbench_history',
  modmind_blockbench_checkpoint: 'blockbench_checkpoint',
  modmind_blockbench_restore_history: 'blockbench_restore_history',
  modmind_asset_compile_intent: 'asset_compile_intent',
  modmind_asset_preview_intent: 'asset_preview_intent',
  modmind_asset_apply_intent: 'asset_apply_intent',
  modmind_asset_compile_refinement: 'asset_compile_refinement',
  modmind_asset_preview_refinement: 'asset_preview_refinement',
  modmind_asset_apply_refinement: 'asset_apply_refinement',
  modmind_asset_compile_advanced: 'asset_compile_advanced',
  modmind_asset_preview_advanced: 'asset_preview_advanced',
  modmind_asset_apply_advanced: 'asset_apply_advanced',
  modmind_asset_compile_reference: 'asset_compile_reference',
  modmind_asset_preview_reference: 'asset_preview_reference',
  modmind_asset_apply_reference: 'asset_apply_reference',
  modmind_asset_visual_review: 'asset_visual_review',
  modmind_runtime_state: 'runtime_state',
  modmind_scan_java_homes: 'scan_java_homes',
  modmind_probe_java_home: 'probe_java_home',
  modmind_get_app_settings: 'get_app_settings',
  modmind_set_app_setting: 'set_app_setting',
  modmind_image_generate: 'image_generate',
  modmind_image_perfect_pixel: 'image_perfect_pixel',
  modmind_image_remove_background: 'image_remove_background',
  modmind_image_project_assets: 'image_project_assets',
  modmind_image_read_project_asset: 'image_read_project_asset',
  modmind_plugins_scaffold: 'plugin_scaffold',
  modmind_plugins_read_source: 'plugin_read_source',
  modmind_plugins_write_files: 'plugin_write_files',
  modmind_plugins_reload: 'plugin_reload'
};

function rpcResult(id, value) {
  return { jsonrpc: '2.0', id, result: value };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toolContent(value) {
  const captures = [...(Array.isArray(value?.captures) ? value.captures : []), ...(Array.isArray(value?.candidates) ? value.candidates.flatMap((candidate) => Array.isArray(candidate?.captures) ? candidate.captures : []) : [])];
  const content = [{ type: 'text', text: JSON.stringify(value, (key, item) => key === 'dataUrl' && typeof item === 'string' ? undefined : item) }];
  for (const capture of captures) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(capture.dataUrl || '');
    if (match) content.push({ type: 'image', mimeType: match[1], data: match[2] });
  }
  return content;
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    write(rpcError(null, -32700, 'Invalid JSON'));
    return;
  }
  if (request.method === 'notifications/initialized' || request.method?.startsWith('notifications/')) return;
  if (request.method === 'initialize') {
    write(rpcResult(request.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'modmind', version: config.version || 'development' }, _meta: { 'dev.modmind/source-fingerprint': config.sourceFingerprint || MODMIND_SOURCE_FINGERPRINT } }));
    return;
  }
  if (request.method === 'tools/list') {
    const pluginTools = await fetchPluginTools();
    write(rpcResult(request.id, { tools: pluginTools.length ? [...tools, ...pluginTools] : tools }));
    return;
  }
  if (request.method === 'tools/call') {
    const name = request.params?.name || '';
    let action = actions[name];
    if (!action && await isPluginToolName(name)) {
      action = 'plugin_tool_call';
    }
    if (!action) {
      write(rpcError(request.id, -32601, 'Unknown ModMind tool'));
      return;
    }
    try {
      const value = await callTool(action, action === 'plugin_tool_call' ? { tool: name, input: request.params?.arguments || {} } : (request.params?.arguments || {}));
      write(rpcResult(request.id, { content: toolContent(value) }));
    } catch (error) {
      write(rpcResult(request.id, { isError: true, content: [{ type: 'text', text: String(error?.message || error) }] }));
    }
    return;
  }
  write(rpcError(request.id, -32601, 'Unsupported MCP method'));
});
