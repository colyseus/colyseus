/**
 * Icon-name → lucide-react component map.
 *
 * The server returns icon names as strings (from defineAdminResource overrides
 * or the default keyword resolver in src-backend/default-icons.ts). Anything
 * not in this map falls back to Database.
 *
 * `iconFor()` returns a React element ready to render — keeps callsites
 * compact: `{iconFor(r.icon)}` instead of `{(() => <Cmp />)()}`.
 */
import {
  User, UserPlus, Users, ShoppingBag, ShoppingCart, LayoutGrid, Trophy,
  Cloud, Save, Settings, Calendar, Clock, LineChart, BarChart3, PieChart,
  LayoutDashboard, FileText, Shield, Key, MessageSquare, Bell, CreditCard,
  Flag, Gift, Smile, MapPin, Hammer, Zap, Ban, AlertTriangle, Shirt,
  Network, Database, Heart, Boxes, Radio,
  type LucideIcon,
} from 'lucide-react';

const MAP: Record<string, LucideIcon> = {
  user: User,
  'user-add': UserPlus,
  team: Users,
  shopping: ShoppingBag,
  'shopping-cart': ShoppingCart,
  appstore: LayoutGrid,
  trophy: Trophy,
  cloud: Cloud,
  save: Save,
  setting: Settings,
  calendar: Calendar,
  'clock-circle': Clock,
  'line-chart': LineChart,
  'bar-chart': BarChart3,
  'pie-chart': PieChart,
  dashboard: LayoutDashboard,
  heart: Heart,
  cluster: Boxes,
  'file-text': FileText,
  safety: Shield,
  key: Key,
  message: MessageSquare,
  bell: Bell,
  'credit-card': CreditCard,
  flag: Flag,
  gift: Gift,
  smile: Smile,
  environment: MapPin,
  build: Hammer,
  thunderbolt: Zap,
  stop: Ban,
  warning: AlertTriangle,
  skin: Shirt,
  'node-index': Network,
  database: Database,
  radio: Radio,
};

export function iconFor(name: string | undefined): React.ReactElement {
  const Icon = (name && MAP[name]) || Database;
  return <Icon className="size-4" aria-hidden />;
}
