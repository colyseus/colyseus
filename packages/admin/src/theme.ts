import type { ThemeConfig } from 'antd';

/**
 * AntD design tokens skinned to a shadcn/ui-style aesthetic:
 *  - neutral zinc palette
 *  - light surfaces with thin borders
 *  - subtle radius (6/8px)
 *  - light Sider (not the default dark)
 *  - tight controls
 */
const zinc = {
  50:  '#fafafa',
  100: '#f4f4f5',
  200: '#e4e4e7',
  300: '#d4d4d8',
  400: '#a1a1aa',
  500: '#71717a',
  600: '#52525b',
  700: '#3f3f46',
  800: '#27272a',
  900: '#18181b',
  950: '#09090b',
};

export const shadcnTheme: ThemeConfig = {
  token: {
    colorPrimary: zinc[900],
    colorInfo: zinc[900],
    colorSuccess: '#16a34a',
    colorWarning: '#d97706',
    colorError: '#dc2626',
    colorTextBase: zinc[950],
    colorBgBase: '#ffffff',
    colorBgLayout: zinc[50],
    colorBgContainer: '#ffffff',
    colorBorder: zinc[200],
    colorBorderSecondary: zinc[100],
    colorFill: zinc[100],
    colorFillSecondary: zinc[100],
    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,
    borderRadiusXS: 4,
    controlHeight: 36,
    controlHeightSM: 30,
    controlHeightLG: 40,
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, ' +
      '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: 14,
    fontWeightStrong: 600,
    lineHeight: 1.5,
    boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
    boxShadowSecondary: '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
    boxShadowTertiary: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
    wireframe: false,
  },
  components: {
    Layout: {
      siderBg: '#ffffff',
      headerBg: '#ffffff',
      bodyBg: zinc[50],
      headerHeight: 56,
      headerPadding: '0 24px',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: zinc[100],
      itemSelectedColor: zinc[950],
      itemHoverBg: zinc[50],
      itemHoverColor: zinc[950],
      itemActiveBg: zinc[100],
      itemColor: zinc[600],
      itemBorderRadius: 6,
      itemMarginInline: 8,
      itemMarginBlock: 2,
      itemHeight: 36,
      iconSize: 14,
      collapsedIconSize: 16,
      subMenuItemBg: 'transparent',
    },
    Button: {
      defaultBg: '#ffffff',
      defaultBorderColor: zinc[200],
      defaultColor: zinc[950],
      defaultHoverBg: zinc[50],
      defaultHoverBorderColor: zinc[300],
      defaultHoverColor: zinc[950],
      defaultActiveBg: zinc[100],
      defaultActiveBorderColor: zinc[300],
      defaultActiveColor: zinc[950],
      colorPrimary: zinc[900],
      colorPrimaryHover: zinc[800],
      colorPrimaryActive: zinc[700],
      colorPrimaryBg: zinc[100],
      paddingInline: 14,
      paddingInlineSM: 10,
      paddingInlineLG: 18,
      fontWeight: 500,
      primaryShadow: 'none',
      defaultShadow: 'none',
    },
    Input: {
      colorBorder: zinc[200],
      activeBorderColor: zinc[900],
      hoverBorderColor: zinc[300],
      activeShadow: '0 0 0 3px rgb(24 24 27 / 0.10)',
      paddingInline: 12,
    },
    InputNumber: {
      colorBorder: zinc[200],
      activeBorderColor: zinc[900],
      hoverBorderColor: zinc[300],
      activeShadow: '0 0 0 3px rgb(24 24 27 / 0.10)',
    },
    Select: {
      colorBorder: zinc[200],
      optionSelectedBg: zinc[100],
      optionActiveBg: zinc[50],
    },
    Table: {
      headerBg: zinc[50],
      headerColor: zinc[600],
      headerSplitColor: zinc[200],
      rowHoverBg: zinc[50],
      borderColor: zinc[200],
      cellPaddingBlock: 10,
      cellPaddingInline: 12,
      headerBorderRadius: 8,
    },
    Card: {
      colorBorderSecondary: zinc[200],
      borderRadiusLG: 8,
      headerBg: 'transparent',
      paddingLG: 20,
    },
    Form: {
      labelFontSize: 13,
      labelColor: zinc[700],
      labelRequiredMarkColor: zinc[400],
      verticalLabelPadding: '0 0 6px 0',
      itemMarginBottom: 18,
    },
    Tag: {
      defaultBg: zinc[100],
      defaultColor: zinc[700],
      borderRadiusSM: 4,
    },
    Dropdown: {
      controlItemBgHover: zinc[50],
      controlItemBgActive: zinc[100],
      borderRadiusLG: 8,
    },
    Modal: {
      borderRadiusLG: 10,
    },
    Pagination: {
      // Active item: light gray background + the dark border, matches the
      // rest of the theme (Menu's `itemSelectedBg`). Previously zinc[900] —
      // the page number text inherited dark color and disappeared.
      itemActiveBg: zinc[100],
      itemBg: '#ffffff',
    },
    Typography: {
      titleMarginTop: 0,
      titleMarginBottom: '.5em',
    },
  },
};
