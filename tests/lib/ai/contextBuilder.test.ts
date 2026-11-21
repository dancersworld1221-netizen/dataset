import { describe, expect, it } from 'vitest';
import { buildDatasetContext } from '@/lib/ai/contextBuilder';
import {
  isValidAiInsightsResponse,
  isValidAiRecommendationsResponse,
  isValidAiReportResponse,
  isValidAiChatResponse,
} from '@/lib/ai/contextBuilder';
import type { DatasetRecord } from '@/types/dataset.types';
import type { AnalyticalReport } from '@/lib/analytics/types';

function buildDataset(recordCount = 100): DatasetRecord {
  return {
    id: 'ds-1',
    filename: 'sample.csv',
    fileSize: 1234,
    fileType: 'text/csv',
    createdAt: '2026-01-01T00:00:00Z',
    recordCount,
    columnCount: 3,
    columns: [
      {
        id: 'col-0',
        name: 'age',
        displayName: 'age',
        dataType: 'integer',
        totalRecords: recordCount,
        nonEmptyCount: 90,
        missingCount: 10,
        missingPercentage: 10,
        uniqueCount: 60,
        duplicateCount: 20,
        invalidCount: 0,
        statistics: {
          min: 20,
          max: 64,
          mean: 42,
          median: 42,
          stdDev: 13,
          q1: 31,
          q3: 53,
          iqr: 22,
          outlierCount: 3,
          skewness: -0.03,
          count: 90,
          topValues: [{ value: '42', count: 5 }],
        },
      },
      {
        id: 'col-1',
        name: 'city',
        displayName: 'city',
        dataType: 'string',
        totalRecords: recordCount,
        nonEmptyCount: 95,
        missingCount: 5,
        missingPercentage: 5,
        uniqueCount: 3,
        duplicateCount: 80,
        invalidCount: 0,
        statistics: { topValues: [{ value: 'NYC', count: 40 }] },
      },
    ],
    status: 'ready',
    parsingWarnings: [],
    parsingErrors: [],
    storageStatus: 'saved',
  };
}

function buildReport(): AnalyticalReport {
  return {
    generatedFor: { datasetId: 'ds-1', filename: 'sample.csv', version: '1' },
    overview: {
      rows: 100,
      columns: 2,
      numericColumns: 1,
      categoricalColumns: 1,
      dateColumns: 0,
      emptyColumns: 0,
      completenessPercentage: 95,
      truncated: false,
    },
    numeric: [],
    categorical: [],
    distributionObservations: [],
    outliers: [
      { column: 'age', method: 'iqr', count: 3, percentage: 3.3, kind: 'statistical-outliers', lowerBound: 10, upperBound: 80 },
    ],
    strongCorrelations: [
      { a: 'age', b: 'income', r: 0.82, n: 90, strength: 'strong', direction: 'positive' },
    ],
    correlationMethod: 'pearson',
    classImbalance: null,
    redundancy: { exactDuplicates: [], highlyCorrelated: [] },
    warnings: [],
  };
}

describe('buildDatasetContext', () => {
  it('builds a context from a dataset profile', () => {
    const dataset = buildDataset();
    const context = buildDatasetContext(dataset);

    expect(context.datasetId).toBe('ds-1');
    expect(context.datasetName).toBe('sample.csv');
    expect(context.rowCount).toBe(100);
    expect(context.columnCount).toBe(3);
    expect(context.columns).toHaveLength(2);
    expect(context.columns[0].name).toBe('age');
    expect(context.columns[0].statistics?.mean).toBe(42);
    expect(context.columns[0].statistics?.outlierCount).toBe(3);
    expect(context.columns[1].name).toBe('city');
    expect(context.truncated).toBe(false);
  });

  it('includes quality issues from the report', () => {
    const dataset = buildDataset();
    dataset.qualityReport = {
      ...dataset.qualityReport!,
      issues: [
        {
          type: 'missing_values',
          columnName: 'age',
          affectedRecordCount: 10,
          severity: 'medium',
          description: '10 missing value(s) in column "age" (10.0%)',
        },
      ],
    };
    const context = buildDatasetContext(dataset);
    expect(context.qualityIssues).toHaveLength(1);
    expect(context.qualityIssues[0].type).toBe('missing_values');
    expect(context.qualityIssues[0].severity).toBe('medium');
  });

  it('includes correlations, outliers and truncation from the analytical report', () => {
    const dataset = buildDataset();
    const context = buildDatasetContext(dataset, buildReport());

    expect(context.strongCorrelations).toHaveLength(1);
    expect(context.strongCorrelations[0].r).toBe(0.82);
    expect(context.outlierColumns).toHaveLength(1);
    expect(context.outlierColumns[0].column).toBe('age');
  });

  it('bounds the number of columns included', () => {
    const dataset = buildDataset(100);
    const manyColumns: DatasetRecord['columns'] = [];
    for (let i = 0; i < 100; i++) {
      manyColumns.push({
        id: `col-${i}`,
        name: `col${i}`,
        displayName: `col${i}`,
        dataType: 'string',
        totalRecords: 100,
        nonEmptyCount: 100,
        missingCount: 0,
        missingPercentage: 0,
        uniqueCount: 10,
        duplicateCount: 80,
        statistics: {},
      });
    }
    const context = buildDatasetContext({ ...dataset, columns: manyColumns, columnCount: 100 });
    expect(context.columns.length).toBeLessThanOrEqual(60);
  });
});

describe('AI response validators', () => {
  it('validates a correct insights response', () => {
    const valid = {
      summary: 'A summary.',
      insights: [
        {
          id: 'i1',
          title: 'Title',
          category: 'statistical',
          severity: 'medium',
          description: 'Desc',
          evidence: [{ label: 'Mean', value: 42 }],
          recommendation: 'Do X',
          confidence: 'high',
        },
      ],
      limitations: ['Limited data.'],
    };
    expect(isValidAiInsightsResponse(valid)).toBe(true);
  });

  it('rejects an insights response with a bad category', () => {
    const bad = {
      summary: 'A summary.',
      insights: [{ id: 'i1', title: 'T', category: 'not-a-category', severity: 'info', description: 'D', evidence: [], recommendation: 'R', confidence: 'low' }],
      limitations: [],
    };
    expect(isValidAiInsightsResponse(bad)).toBe(false);
  });

  it('rejects a non-object insights response', () => {
    expect(isValidAiInsightsResponse(null)).toBe(false);
    expect(isValidAiInsightsResponse('nope')).toBe(false);
    expect(isValidAiInsightsResponse({ summary: 'x' })).toBe(false);
  });

  it('validates a correct recommendations response', () => {
    const valid = {
      recommendations: [
        {
          id: 'r1',
          title: 'Rec',
          explanation: 'Why',
          reason: 'Because',
          evidence: [{ label: 'Count', value: 3 }],
          priority: 'high',
          suggestedNextStep: 'Review column',
        },
      ],
    };
    expect(isValidAiRecommendationsResponse(valid)).toBe(true);
  });

  it('rejects a recommendations response with a bad priority', () => {
    const bad = {
      recommendations: [{ id: 'r1', title: 'T', explanation: 'E', reason: 'R', evidence: [], priority: 'urgent', suggestedNextStep: 'S' }],
    };
    expect(isValidAiRecommendationsResponse(bad)).toBe(false);
  });

  it('validates a correct report response', () => {
    expect(isValidAiReportResponse({ report: '# Title' })).toBe(true);
    expect(isValidAiReportResponse({ report: '' })).toBe(false);
    expect(isValidAiReportResponse(null)).toBe(false);
  });

  it('validates a chat response', () => {
    expect(isValidAiChatResponse({ text: 'Hello' })).toBe(true);
    expect(isValidAiChatResponse({})).toBe(false);
    expect(isValidAiChatResponse(null)).toBe(false);
  });
});
