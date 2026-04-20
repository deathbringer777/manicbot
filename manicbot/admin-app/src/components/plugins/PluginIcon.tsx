"use client";

/**
 * Renders a plugin icon by lucide-react name + hex tint.
 * Unknown names fall back to `Puzzle`.
 */

import {
  Puzzle, Rocket, Sparkles, Shield, Zap, Bell, Users, CalendarDays,
  Star, Gift, HeartPulse, BarChart3, PieChart, DollarSign, CreditCard,
  Send, MessageSquare, Phone, Mail, Smartphone, Cog, Eye, Search,
  Image, Globe, Palette, FileText, Download, Upload, ClipboardList,
  LayoutGrid, Layers, Wrench, Inbox, HeadphonesIcon, Scissors,
  Wallet, UserRound, UserCog, ArrowLeftRight, Timer, Receipt,
  Activity, Compass, BookOpen, Tag, KeySquare, ShoppingBag, Link2,
  Sun, Moon, Brain, Megaphone, Trophy, Share2, Coffee, Hash,
  TrendingUp, AlertTriangle, Lock, CheckCircle2, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Puzzle, Rocket, Sparkles, Shield, Zap, Bell, Users, CalendarDays,
  Star, Gift, HeartPulse, BarChart3, PieChart, DollarSign, CreditCard,
  Send, MessageSquare, Phone, Mail, Smartphone, Cog, Eye, Search,
  Image, Globe, Palette, FileText, Download, Upload, ClipboardList,
  LayoutGrid, Layers, Wrench, Inbox, HeadphonesIcon, Scissors,
  Wallet, UserRound, UserCog, ArrowLeftRight, Timer, Receipt,
  Activity, Compass, BookOpen, Tag, KeySquare, ShoppingBag, Link2,
  Sun, Moon, Brain, Megaphone, Trophy, Share2, Coffee, Hash,
  TrendingUp, AlertTriangle, Lock, CheckCircle2,
};

export function PluginIcon({
  name,
  tint,
  size = 24,
  className = "",
}: {
  name: string;
  tint: string;
  size?: number;
  className?: string;
}) {
  const Icon = ICONS[name] ?? Puzzle;
  return (
    <div
      className={`inline-flex items-center justify-center rounded-xl ${className}`}
      style={{
        width: size + 20,
        height: size + 20,
        backgroundColor: `${tint}20`,
        color: tint,
      }}
      aria-hidden="true"
    >
      <Icon size={size} />
    </div>
  );
}

export const AVAILABLE_ICON_NAMES = Object.keys(ICONS);
