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

/**
 * Pixel-accurate recreation of the Google Calendar app icon (2020+ design).
 *
 * Structure (48-unit grid, clipped to rounded square):
 *   Blue #4285F4     – main background (top-left ¾)
 *   Dark blue #1967D2 – top-right corner (12×12)
 *   Yellow #FBBC04   – right strip middle (12×24)
 *   Dark green #188038 – bottom-left corner (12×12)
 *   Green #34A853    – bottom-center strip (24×12)
 *   Red #EA4335      – bottom-right corner (12×12)
 *   White            – inner box (24×24 centered)
 *   "31" #4285F4     – bold numeral inside the white box
 *
 * Rendered at (size + 20) to match the container size of lucide-based icons.
 */
function GoogleCalendarLogo({ size, className = "" }: { size: number; className?: string }) {
  const total = size + 20;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={total}
      height={total}
      aria-hidden="true"
      className={className}
    >
      <defs>
        <clipPath id="gcal-clip">
          <rect width="48" height="48" rx="8" />
        </clipPath>
      </defs>
      <g clipPath="url(#gcal-clip)">
        {/* Blue main background */}
        <rect width="48" height="48" fill="#4285F4" />
        {/* Dark blue – top-right corner */}
        <rect x="36" y="0" width="12" height="12" fill="#1967D2" />
        {/* Yellow – right strip */}
        <rect x="36" y="12" width="12" height="24" fill="#FBBC04" />
        {/* Dark green – bottom-left corner */}
        <rect x="0" y="36" width="12" height="12" fill="#188038" />
        {/* Green – bottom-center */}
        <rect x="12" y="36" width="24" height="12" fill="#34A853" />
        {/* Red – bottom-right corner */}
        <rect x="36" y="36" width="12" height="12" fill="#EA4335" />
        {/* White inner box */}
        <rect x="12" y="12" width="24" height="24" fill="#fff" />
        {/* "31" numeral */}
        <text
          x="24"
          y="31"
          textAnchor="middle"
          fontFamily="'Google Sans', Arial, sans-serif"
          fontSize="16"
          fontWeight="700"
          fill="#4285F4"
        >31</text>
      </g>
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
    return <GoogleCalendarLogo size={size} className={className} />;
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
