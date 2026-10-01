import type { FolderIconName } from "@wlfv/shared";
import {
  BookOpen,
  Bot,
  Briefcase,
  Camera,
  Code,
  Coffee,
  Folder,
  Gamepad2,
  Globe,
  GraduationCap,
  Heart,
  Home,
  Leaf,
  Lightbulb,
  Music,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Zap,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<FolderIconName, LucideIcon> = {
  folder: Folder,
  briefcase: Briefcase,
  code: Code,
  book: BookOpen,
  heart: Heart,
  star: Star,
  home: Home,
  rocket: Rocket,
  bot: Bot,
  sparkles: Sparkles,
  graduation: GraduationCap,
  music: Music,
  camera: Camera,
  globe: Globe,
  shield: Shield,
  zap: Zap,
  coffee: Coffee,
  gamepad: Gamepad2,
  lightbulb: Lightbulb,
  leaf: Leaf,
};

export function FolderGlyph({
  icon,
  color,
  size = 14,
}: {
  icon: FolderIconName;
  color: string;
  size?: number;
}) {
  const Icon = ICONS[icon] || Folder;
  return <Icon size={size} style={{ color }} className="shrink-0" />;
}
