'use strict';

const Ajv = require('ajv');

const str = { type: 'string', maxLength: 2_000 };
const nonEmpty = { type: 'string', minLength: 1, maxLength: 4_000 };
const markdown = { type: 'string', minLength: 1, maxLength: 9_000 };
const stringArray = { type: 'array', maxItems: 30, items: str };

const decision = {
  type: 'object',
  additionalProperties: false,
  required: ['topic', 'decision', 'rationale', 'status'],
  properties: {
    topic: nonEmpty,
    decision: nonEmpty,
    rationale: nonEmpty,
    status: { type: 'string', enum: ['decided', 'provisional', 'open'] },
  },
};

const assumption = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'impact', 'reversible'],
  properties: {
    text: nonEmpty,
    impact: nonEmpty,
    reversible: { type: 'boolean' },
  },
};

const question = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'question', 'impact'],
  properties: {
    id: nonEmpty,
    question: nonEmpty,
    impact: nonEmpty,
  },
};

const risk = {
  type: 'object',
  additionalProperties: false,
  required: ['risk', 'trigger', 'impact', 'mitigation'],
  properties: {
    risk: nonEmpty,
    trigger: nonEmpty,
    impact: nonEmpty,
    mitigation: nonEmpty,
  },
};

const synthesisRisk = {
  type: 'object',
  additionalProperties: false,
  required: ['risk', 'severity', 'trigger', 'impact', 'mitigation', 'owner', 'recovery'],
  properties: {
    risk: nonEmpty,
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    trigger: nonEmpty,
    impact: nonEmpty,
    mitigation: nonEmpty,
    owner: nonEmpty,
    recovery: nonEmpty,
  },
};

const harnessRole = {
  type: 'object',
  additionalProperties: false,
  required: [
    'mission', 'responsibilities', 'operatingRules', 'qualityChecks', 'boundaries', 'outputContract',
  ],
  properties: {
    mission: nonEmpty,
    responsibilities: { type: 'array', minItems: 1, maxItems: 20, items: nonEmpty },
    operatingRules: { type: 'array', minItems: 1, maxItems: 20, items: nonEmpty },
    qualityChecks: { type: 'array', minItems: 1, maxItems: 20, items: nonEmpty },
    boundaries: { type: 'array', minItems: 1, maxItems: 20, items: nonEmpty },
    outputContract: nonEmpty,
    customInstructions: { type: 'string', maxLength: 24 * 1024 },
  },
};

const harnessSet = {
  $id: 'HarnessSet',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion', 'artifactType', 'cycle', 'rationale',
    'orchestrator', 'claudeWorker', 'codexWorker',
  ],
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    artifactType: { type: 'string', const: 'harness_set' },
    cycle: { type: 'integer', minimum: 0 },
    rationale: nonEmpty,
    orchestrator: harnessRole,
    claudeWorker: harnessRole,
    codexWorker: harnessRole,
  },
};

const taskPackage = {
  $id: 'TaskPackage',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion', 'artifactType', 'cycle', 'objective', 'deliverable',
    'requirements', 'constraints', 'assumptions', 'missingInformation',
    'workerAssignments', 'acceptanceCriteria', 'feedbackDelta',
  ],
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    artifactType: { type: 'string', const: 'task_package' },
    cycle: { type: 'integer', minimum: 1 },
    objective: nonEmpty,
    deliverable: {
      type: 'object', additionalProperties: false,
      required: ['kind', 'audience', 'format', 'scope'],
      properties: { kind: nonEmpty, audience: nonEmpty, format: nonEmpty, scope: nonEmpty },
    },
    requirements: {
      type: 'array', minItems: 1, maxItems: 30,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'text', 'priority'],
        properties: { id: nonEmpty, text: nonEmpty, priority: { type: 'string', enum: ['must', 'should'] } },
      },
    },
    constraints: stringArray,
    assumptions: { type: 'array', items: assumption },
    missingInformation: {
      type: 'array', maxItems: 20, items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'question', 'required', 'impact'],
        properties: { id: nonEmpty, question: nonEmpty, required: { type: 'boolean' }, impact: nonEmpty },
      },
    },
    workerAssignments: {
      type: 'object', additionalProperties: false, required: ['claude', 'codex'],
      properties: {
        claude: {
          type: 'object', additionalProperties: false, required: ['focus', 'deliverables'],
          properties: { focus: nonEmpty, deliverables: stringArray },
        },
        codex: {
          type: 'object', additionalProperties: false, required: ['focus', 'deliverables'],
          properties: { focus: nonEmpty, deliverables: stringArray },
        },
      },
    },
    acceptanceCriteria: stringArray,
    feedbackDelta: {
      type: 'object', additionalProperties: false, required: ['change', 'retain', 'remove'],
      properties: { change: stringArray, retain: stringArray, remove: stringArray },
    },
  },
};

const draft = {
  $id: 'Draft',
  type: 'object', additionalProperties: false,
  required: [
    'schemaVersion', 'artifactType', 'author', 'perspective', 'summary', 'planMarkdown',
    'decisions', 'requirementCoverage', 'assumptions', 'questions', 'risks', 'evidenceNeeds',
  ],
  properties: {
    schemaVersion: { type: 'integer', const: 1 }, artifactType: { type: 'string', const: 'draft' },
    author: { type: 'string', enum: ['claude', 'codex'] }, perspective: nonEmpty,
    summary: nonEmpty, planMarkdown: markdown,
    decisions: { type: 'array', maxItems: 20, items: decision },
    requirementCoverage: stringArray,
    assumptions: { type: 'array', maxItems: 15, items: assumption },
    questions: { type: 'array', maxItems: 20, items: { ...question, required: ['id', 'question', 'impact', 'required'], properties: { ...question.properties, required: { type: 'boolean' } } } },
    risks: { type: 'array', maxItems: 20, items: risk },
    evidenceNeeds: stringArray,
  },
};

const critique = {
  $id: 'Critique',
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'artifactType', 'reviewer', 'subjectAuthor', 'verdict', 'strengths', 'issues', 'missingRequirementIds'],
  properties: {
    schemaVersion: { type: 'integer', const: 1 }, artifactType: { type: 'string', const: 'critique' },
    reviewer: { type: 'string', enum: ['claude', 'codex'] }, subjectAuthor: { type: 'string', enum: ['claude', 'codex'] },
    verdict: { type: 'string', enum: ['accept', 'revise'] }, strengths: stringArray,
    issues: {
      type: 'array', maxItems: 10, items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'severity', 'category', 'description', 'recommendation', 'requirementIds'],
        properties: {
          id: nonEmpty, severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          category: nonEmpty, description: nonEmpty, recommendation: nonEmpty,
          requirementIds: stringArray,
        },
      },
    },
    missingRequirementIds: stringArray,
  },
};

const revision = {
  $id: 'Revision',
  type: 'object', additionalProperties: false,
  required: [
    'schemaVersion', 'artifactType', 'author', 'summary', 'planMarkdown', 'decisions',
    'requirementCoverage', 'assumptions', 'questions', 'risks', 'evidenceNeeds', 'changeLog',
  ],
  properties: {
    schemaVersion: { type: 'integer', const: 1 }, artifactType: { type: 'string', const: 'revision' },
    author: { type: 'string', enum: ['claude', 'codex'] }, summary: nonEmpty, planMarkdown: markdown,
    decisions: { type: 'array', maxItems: 20, items: decision }, requirementCoverage: stringArray,
    assumptions: { type: 'array', maxItems: 15, items: assumption },
    questions: { type: 'array', maxItems: 20, items: { ...question, required: ['id', 'question', 'impact', 'required'], properties: { ...question.properties, required: { type: 'boolean' } } } },
    risks: { type: 'array', maxItems: 20, items: risk }, evidenceNeeds: stringArray,
    changeLog: {
      type: 'array', maxItems: 20, items: {
        type: 'object', additionalProperties: false,
        required: ['issueId', 'disposition', 'reason'],
        properties: { issueId: nonEmpty, disposition: { type: 'string', enum: ['accepted', 'modified', 'rejected'] }, reason: nonEmpty },
      },
    },
  },
};

const synthesis = {
  $id: 'Synthesis',
  type: 'object', additionalProperties: false,
  required: [
    'schemaVersion', 'artifactType', 'planVersion', 'title', 'status', 'executiveSummary',
    'planMarkdown', 'decisions', 'requirementTraceability', 'integration', 'assumptions',
    'requiredQuestions', 'optionalQuestions', 'risks', 'validationPlan', 'measurableTargets',
    'feedbackTraceability', 'changeSummary', 'nextActions',
  ],
  properties: {
    schemaVersion: { type: 'integer', const: 1 }, artifactType: { type: 'string', const: 'synthesis' },
    planVersion: { type: 'integer', minimum: 1 }, title: nonEmpty,
    status: { type: 'string', enum: ['needs_input', 'ready_for_approval'] },
    executiveSummary: nonEmpty, planMarkdown: markdown,
    decisions: { type: 'array', maxItems: 25, items: decision },
    requirementTraceability: {
      type: 'array', minItems: 1, maxItems: 40, items: {
        type: 'object', additionalProperties: false,
        required: ['requirementId', 'status', 'evidence'],
        properties: { requirementId: nonEmpty, status: { type: 'string', enum: ['covered', 'partial', 'blocked'] }, evidence: nonEmpty },
      },
    },
    integration: {
      type: 'object', additionalProperties: false,
      required: ['acceptedFromClaude', 'acceptedFromCodex', 'conflicts', 'orchestratorChanges'],
      properties: {
        acceptedFromClaude: stringArray, acceptedFromCodex: stringArray,
        conflicts: { type: 'array', maxItems: 15, items: { type: 'object', additionalProperties: false, required: ['topic', 'resolution', 'rationale'], properties: { topic: nonEmpty, resolution: nonEmpty, rationale: nonEmpty } } },
        orchestratorChanges: stringArray,
      },
    },
    assumptions: { type: 'array', maxItems: 15, items: assumption },
    requiredQuestions: { type: 'array', maxItems: 20, items: question },
    optionalQuestions: { type: 'array', maxItems: 20, items: question },
    risks: { type: 'array', maxItems: 20, items: synthesisRisk },
    validationPlan: {
      type: 'array', minItems: 1, maxItems: 20, items: {
        type: 'object', additionalProperties: false,
        required: ['requirementIds', 'criterion', 'method', 'evidence', 'passCondition', 'negativeTest', 'owner'],
        properties: {
          requirementIds: { type: 'array', minItems: 1, maxItems: 30, items: nonEmpty },
          criterion: nonEmpty,
          method: nonEmpty,
          evidence: nonEmpty,
          passCondition: nonEmpty,
          negativeTest: nonEmpty,
          owner: nonEmpty,
        },
      },
    },
    measurableTargets: {
      type: 'object', additionalProperties: false,
      required: ['targetPages', 'validationDays', 'analysisModules', 'priceScenarios', 'yieldScenarios'],
      properties: {
        targetPages: { type: 'integer', minimum: 0 },
        validationDays: { type: 'integer', minimum: 0 },
        analysisModules: stringArray,
        priceScenarios: stringArray,
        yieldScenarios: stringArray,
      },
    },
    feedbackTraceability: {
      // 여러 피드백 cycle을 거치며 addressed ID를 계속 보존한다. Canonical
      // 시나리오만 해도 기존 20개 + 신규 Q/FB 8개이므로 20개 상한은
      // 의미 보존 규칙과 충돌한다.
      type: 'array', maxItems: 40, items: {
        type: 'object', additionalProperties: false,
        required: ['feedbackId', 'status', 'evidence'],
        properties: {
          feedbackId: nonEmpty,
          status: { type: 'string', enum: ['addressed', 'partial', 'rejected'] },
          evidence: nonEmpty,
        },
      },
    },
    changeSummary: stringArray,
    nextActions: {
      type: 'array', minItems: 2, maxItems: 5, items: {
        type: 'object', additionalProperties: false,
        required: ['action', 'when', 'outcome'],
        properties: { action: nonEmpty, when: nonEmpty, outcome: nonEmpty },
      },
    },
  },
};

const schemas = Object.freeze({ harnessSet, taskPackage, draft, critique, revision, synthesis });
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, ajv.compile(schema)]));

function parseStructured(raw) {
  if (raw && typeof raw === 'object') return raw;
  let text = String(raw ?? '').trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1].trim();
  try {
    return JSON.parse(text);
  } catch (error) {
    const wrapped = new Error(`구조화 응답을 JSON으로 해석할 수 없습니다: ${error.message}`);
    wrapped.name = 'StructuredOutputError';
    wrapped.raw = text.slice(0, 2_000);
    throw wrapped;
  }
}

function validateArtifact(type, value) {
  const validate = validators[type];
  if (!validate) throw new Error(`알 수 없는 스키마: ${type}`);
  const valid = validate(value);
  return { valid, errors: valid ? [] : (validate.errors || []).map((e) => ({ path: e.instancePath || '/', message: e.message })) };
}

function assertArtifact(type, value) {
  const result = validateArtifact(type, value);
  if (!result.valid) {
    const error = new Error(`${type} 스키마 검증 실패: ${result.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
    error.name = 'SchemaValidationError';
    error.validationErrors = result.errors;
    throw error;
  }
  return value;
}

function schemaFor(type) {
  const schema = schemas[type];
  if (!schema) throw new Error(`알 수 없는 스키마: ${type}`);
  return schema;
}

module.exports = { schemas, schemaFor, parseStructured, validateArtifact, assertArtifact };
