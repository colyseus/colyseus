/**
 * Icon-name → AntD icon component map.
 *
 * The server returns icon names as strings (from defineAdminResource overrides
 * or the default keyword resolver in src-backend/default-icons.ts). Anything
 * not in this map falls back to DatabaseOutlined.
 */
import {
  UserOutlined,
  UserAddOutlined,
  TeamOutlined,
  ShoppingOutlined,
  ShoppingCartOutlined,
  AppstoreOutlined,
  TrophyOutlined,
  CloudOutlined,
  SaveOutlined,
  SettingOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  LineChartOutlined,
  BarChartOutlined,
  FileTextOutlined,
  SafetyOutlined,
  KeyOutlined,
  MessageOutlined,
  BellOutlined,
  CreditCardOutlined,
  FlagOutlined,
  GiftOutlined,
  SmileOutlined,
  EnvironmentOutlined,
  BuildOutlined,
  ThunderboltOutlined,
  StopOutlined,
  WarningOutlined,
  SkinOutlined,
  NodeIndexOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import type React from 'react';

const MAP: Record<string, React.ReactElement> = {
  user: <UserOutlined />,
  'user-add': <UserAddOutlined />,
  team: <TeamOutlined />,
  shopping: <ShoppingOutlined />,
  'shopping-cart': <ShoppingCartOutlined />,
  appstore: <AppstoreOutlined />,
  trophy: <TrophyOutlined />,
  cloud: <CloudOutlined />,
  save: <SaveOutlined />,
  setting: <SettingOutlined />,
  calendar: <CalendarOutlined />,
  'clock-circle': <ClockCircleOutlined />,
  'line-chart': <LineChartOutlined />,
  'bar-chart': <BarChartOutlined />,
  'file-text': <FileTextOutlined />,
  safety: <SafetyOutlined />,
  key: <KeyOutlined />,
  message: <MessageOutlined />,
  bell: <BellOutlined />,
  'credit-card': <CreditCardOutlined />,
  flag: <FlagOutlined />,
  gift: <GiftOutlined />,
  smile: <SmileOutlined />,
  environment: <EnvironmentOutlined />,
  build: <BuildOutlined />,
  thunderbolt: <ThunderboltOutlined />,
  stop: <StopOutlined />,
  warning: <WarningOutlined />,
  skin: <SkinOutlined />,
  'node-index': <NodeIndexOutlined />,
  database: <DatabaseOutlined />,
};

export function iconFor(name: string | undefined): React.ReactElement {
  if (!name) { return MAP.database!; }
  return MAP[name] ?? MAP.database!;
}
