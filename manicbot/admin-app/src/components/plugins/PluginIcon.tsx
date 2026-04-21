"use client";

/**
 * Renders a plugin icon by lucide-react name + hex tint.
 * Unknown names fall back to `Puzzle`.
 * Special case: name === "GoogleCalendar" renders the official inline SVG logo.
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

function GoogleCalendarLogo({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <rect x="8" y="8" width="32" height="32" rx="4" fill="#fff" stroke="#e8eaed" strokeWidth="1" />
      <rect x="8" y="8" width="32" height="6" rx="4" fill="#4285f4" />
      <rect x="8" y="8" width="32" height="2" fill="#4285f4" />
      <text x="24" y="30" textAnchor="middle" fontFamily="'Google Sans', Arial, sans-serif" fontSize="14" fontWeight="500" fill="#4285f4">31</text>
      <rect x="14" y="6" width="2" height="6" rx="1" fill="#1a73e8" />
      <rect x="32" y="6" width="2" height="6" rx="1" fill="#1a73e8" />
    </svg>
  );
}

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
  if (name === "GoogleCalendar") {
    return (
      <div
        className={`inline-flex items-center justify-center rounded-xl ${className}`}
        style={{
          width: size + 20,
          height: size + 20,
          backgroundColor: "#fff",
          border: "1px solid #e8eaed",
        }}
        aria-hidden="true"
      >
        <GoogleCalendarLogo size={size} />
      </div>
    );
  }

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
