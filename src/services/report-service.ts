import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Monitor, StatisticsSeries } from '../db/models';

export async function makePdfReport(
  monitor: Monitor,
  from: string,
  to: string,
  series: StatisticsSeries,
) {
  const stats = series.summary;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = 790;

  const line = (text: string, strong = false) => {
    page.drawText(text, {
      x: 48,
      y,
      size: strong ? 18 : 11,
      font: strong ? bold : font,
      color: rgb(0.08, 0.12, 0.2),
    });

    y -= strong ? 38 : 22;
  };

  line('Website/API Health Report', true);
  line(`Monitor: ${monitor.name}`);
  line(`Period: ${from} to ${to}`);

  y -= 12;

  line(
    `Uptime: ${stats.totalChecks ? `${stats.uptimePercentage}%` : 'N/A'}`,
    true,
  );
  line(`Checks: ${stats.totalChecks}`);
  line(`Successful: ${stats.successfulChecks}`);
  line(`Failed: ${stats.failedChecks}`);
  line(
    `Average response: ${stats.averageResponseMs ?? 'N/A'} ms`,
  );
  line(
    `Minimum / maximum: ${stats.minimumResponseMs ?? 'N/A'
    } / ${stats.maximumResponseMs ?? 'N/A'} ms`,
  );
  line(`Incidents: ${stats.incidentCount}`);
  line(`Total downtime: ${stats.totalDowntimeSeconds} seconds`);

  y -= 8;
  page.drawText('Trends', {
    x: 48, y, size: 13, font: bold, color: rgb(0.08, 0.12, 0.2),
  });
  y -= 16;

  // Both trends cover the full requested reporting period (previously the
  // response-time chart silently truncated to the last 30 points and
  // availability was never drawn at all, despite the section heading
  // claiming otherwise).
  const points = series.points;
  const chartsTop = y;
  const chartHeight = 132;
  const chartGap = 16;
  const chartsWidth = 499;
  const chartWidth = (chartsWidth - chartGap) / 2;
  const chartY = chartsTop - chartHeight;

  const responsePoints: PdfChartPoint[] = points.map((point) => ({
    label: point.date,
    value: point.averageResponseMs,
  }));

  const availabilityPoints: PdfChartPoint[] = points.map((point) => ({
    label: point.date,
    value: point.totalChecks > 0 ? point.uptimePercentage : null,
  }));

  drawLineChart(
    page,
    {
      x: 48,
      y: chartY,
      width: chartWidth,
      height: chartHeight,
      points: responsePoints,
      title: 'Response time trend',
      valueFormatter: formatMs,
    },
    font,
    bold,
  );

  drawLineChart(
    page,
    {
      x: 48 + chartWidth + chartGap,
      y: chartY,
      width: chartWidth,
      height: chartHeight,
      points: availabilityPoints,
      min: 0,
      max: 100,
      title: 'Availability trend',
      valueFormatter: (value) => `${Math.round(value)}%`,
    },
    font,
    bold,
  );

  y = chartY - 32;

  page.drawText('Failure breakdown (recent detailed checks)', {
    x: 48, y, size: 13, font: bold, color: rgb(0.08, 0.12, 0.2),
  });
  y -= 16;
  const largestFailure = Math.max(...series.failureTypes.map((item) => item.count), 1);
  for (const item of series.failureTypes.slice(0, 4)) {
    page.drawText(item.type.replaceAll('_', ' '), { x: 48, y, size: 9, font, color: rgb(0.18, 0.24, 0.31) });
    page.drawRectangle({ x: 180, y: y - 2, width: 230 * (item.count / largestFailure), height: 8, color: rgb(0.91, 0.33, 0.39) });
    page.drawText(String(item.count), { x: 420, y, size: 9, font: bold, color: rgb(0.18, 0.24, 0.31) });
    y -= 18;
  }
  if (!series.failureTypes.length) {
    page.drawText('No failed detailed checks in this period.', { x: 48, y, size: 9, font, color: rgb(0.28, 0.35, 0.43) });
  }

  return pdf.save();
}

type PdfChartPoint = {
  label: string;
  value: number | null;
};

function niceCeiling(value: number) {
  if (value <= 10) return 10;
  if (value <= 25) return 25;
  if (value <= 50) return 50;
  if (value <= 100) return 100;
  if (value <= 250) return 250;
  if (value <= 500) return 500;
  if (value <= 1000) return 1000;

  const magnitude =
    10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;

  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;

  return 10 * magnitude;
}

function formatMs(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(
      value >= 10_000 ? 0 : 1,
    )}s`;
  }

  return `${Math.round(value)}ms`;
}

function drawLineChart(
  page: ReturnType<PDFDocument['addPage']>,
  {
    x,
    y,
    width,
    height,
    points,
    min = 0,
    max,
    title,
    valueFormatter,
  }: {
    x: number;
    y: number;
    width: number;
    height: number;
    points: PdfChartPoint[];
    min?: number;
    max?: number;
    title: string;
    valueFormatter: (value: number) => string;
  },
  font: Awaited<
    ReturnType<PDFDocument['embedFont']>
  >,
  bold: Awaited<
    ReturnType<PDFDocument['embedFont']>
  >,
) {
  const values = points
    .map((point) => point.value)
    .filter((value): value is number => value !== null);

  const axisLeft = x + 48;
  const axisRight = x + width;
  const axisBottom = y;
  const axisTop = y + height - 20;

  page.drawText(title, {
    x,
    y: axisTop + 14,
    size: 11,
    font: bold,
    color: rgb(0.08, 0.12, 0.2),
  });

  if (!values.length) {
    page.drawRectangle({
      x: axisLeft,
      y: axisBottom,
      width: width - 48,
      height: height - 20,
      color: rgb(0.96, 0.97, 0.98),
    });

    page.drawText('N/A - no applicable readings.', {
      x: axisLeft + 12,
      y: axisBottom + (height - 20) / 2,
      size: 9,
      font,
      color: rgb(0.35, 0.4, 0.46),
    });

    return;
  }

  const chartWidth = axisRight - axisLeft;
  const chartHeight = axisTop - axisBottom;

  const chartMax =
    max ?? niceCeiling(Math.max(...values, 1));

  const range = Math.max(chartMax - min, 1);

  const xForIndex = (index: number) =>
    points.length === 1
      ? axisLeft + chartWidth / 2
      : axisLeft +
      (index / (points.length - 1)) * chartWidth;

  const yForValue = (value: number) =>
    axisBottom +
    ((value - min) / range) * chartHeight;

  const tickCount = 5;

  for (let index = 0; index < tickCount; index += 1) {
    const value =
      min +
      ((chartMax - min) * index) /
      (tickCount - 1);

    const tickY = yForValue(value);

    page.drawLine({
      start: {
        x: axisLeft,
        y: tickY,
      },
      end: {
        x: axisRight,
        y: tickY,
      },
      thickness: 0.5,
      color: rgb(0.82, 0.85, 0.88),
    });

    page.drawText(valueFormatter(value), {
      x,
      y: tickY - 3,
      size: 7,
      font,
      color: rgb(0.35, 0.4, 0.46),
    });
  }

  page.drawLine({
    start: {
      x: axisLeft,
      y: axisBottom,
    },
    end: {
      x: axisLeft,
      y: axisTop,
    },
    thickness: 0.8,
    color: rgb(0.45, 0.5, 0.56),
  });

  page.drawLine({
    start: {
      x: axisLeft,
      y: axisBottom,
    },
    end: {
      x: axisRight,
      y: axisBottom,
    },
    thickness: 0.8,
    color: rgb(0.45, 0.5, 0.56),
  });

  const segments: Array<
    Array<{ index: number; value: number }>
  > = [];

  let current: Array<{
    index: number;
    value: number;
  }> = [];

  points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length) {
        segments.push(current);
        current = [];
      }
      return;
    }

    current.push({
      index,
      value: point.value,
    });
  });

  if (current.length) {
    segments.push(current);
  }

  for (const segment of segments) {
    for (
      let index = 1;
      index < segment.length;
      index += 1
    ) {
      const previous = segment[index - 1];
      const currentPoint = segment[index];

      page.drawLine({
        start: {
          x: xForIndex(previous.index),
          y: yForValue(previous.value),
        },
        end: {
          x: xForIndex(currentPoint.index),
          y: yForValue(currentPoint.value),
        },
        thickness: 1.5,
        color: rgb(0.08, 0.62, 0.52),
      });
    }
  }

  for (const point of points) {
    if (point.value === null) continue;

    page.drawCircle({
      x: xForIndex(
        points.findIndex(
          (candidate) => candidate === point,
        ),
      ),
      y: yForValue(point.value),
      size: 2.4,
      color: rgb(0.08, 0.62, 0.52),
    });
  }

  const labelIndexes =
    points.length <= 7
      ? points.map((_, index) => index)
      : [0, Math.floor(points.length / 2), points.length - 1];

  for (const index of labelIndexes) {
    const point = points[index];

    page.drawText(shortDate(point.label), {
      x: xForIndex(index) - 16,
      y: axisBottom - 14,
      size: 7,
      font,
      color: rgb(0.35, 0.4, 0.46),
    });
  }
}

function shortDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}