/**
 * chartTheme.js — ECharts theme aligned with ESDS design tokens.
 * Returns dark or light theme config based on current [data-theme].
 */

const PALETTE = [
  '#6366F1', '#22D3EE', '#10B981', '#F59E0B', '#F43F5E',
  '#8B5CF6', '#3B82F6', '#14B8A6', '#F97316', '#EC4899',
  '#0EA5E9', '#A855F7', '#84CC16', '#EF4444', '#06B6D4',
];

const FONT = "'DM Sans','Inter',sans-serif";

export function getChartTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

  return {
    darkMode: isDark,
    palette: PALETTE,
    backgroundColor: 'transparent',

    text:        isDark ? '#E2E8F0' : '#1E293B',
    textMuted:   isDark ? '#94A3B8' : '#64748B',
    border:      isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    splitLine:   isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    tooltipBg:   isDark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.97)',
    tooltipBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    tooltipText: isDark ? '#E2E8F0' : '#1E293B',
    areaGrad1:   isDark ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.15)',
    areaGrad2:   isDark ? 'rgba(99,102,241,0)' : 'rgba(99,102,241,0)',

    axisLabel: {
      fontFamily: FONT,
      fontSize: 11,
      color: isDark ? '#94A3B8' : '#64748B',
    },

    title: {
      textStyle: { fontFamily: FONT, fontSize: 13, fontWeight: 600, color: isDark ? '#E2E8F0' : '#1E293B' },
      subtextStyle: { fontFamily: FONT, fontSize: 11, color: isDark ? '#64748B' : '#94A3B8' },
    },

    tooltip() {
      return {
        backgroundColor: this.tooltipBg,
        borderColor: this.tooltipBorder,
        borderWidth: 1,
        textStyle: { fontFamily: FONT, fontSize: 12, color: this.tooltipText },
        extraCssText: 'border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.25);backdrop-filter:blur(12px);padding:10px 14px;',
      };
    },

    legend() {
      return {
        textStyle: { fontFamily: FONT, fontSize: 11, color: this.textMuted },
        icon: 'roundRect',
        itemWidth: 12,
        itemHeight: 8,
        itemGap: 14,
      };
    },

    axis() {
      return {
        axisLabel: this.axisLabel,
        axisLine:  { lineStyle: { color: this.border } },
        splitLine: { lineStyle: { color: this.splitLine, type: 'dashed' } },
        axisTick:  { show: false },
      };
    },
  };
}
