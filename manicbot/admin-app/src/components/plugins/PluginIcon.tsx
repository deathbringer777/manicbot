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
 * Faithful recreation of the Google Calendar icon.
 * Uses the official Google brand palette at a 24×24 viewBox so every
 * pixel is meaningful even at size=22 (plugin cards) or size=32 (detail page).
 *
 *   Blue   #4285F4  – top header bar + "31" numeral
 *   Green  #34A853  – bottom-right quadrant accent
 *   Yellow #FBBC05  – bottom-left quadrant accent
 *   Red    #EA4335  – top-right ring pin knob
 */
function GoogleCalendarLogo({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
    >
      {/* Card body */}
      <rect x="1.5" y="2" width="21" height="21" rx="3" fill="#fff" stroke="#dadce0" strokeWidth="0.75" />

      {/* Blue header */}
      <rect x="1.5" y="2" width="21" height="6" rx="3" fill="#4285F4" />
      <rect x="1.5" y="5" width="21" height="3" fill="#4285F4" />

      {/* Ring pins */}
      <rect x="7"  y="0.5" width="2" height="4" rx="1" fill="#1565C0" />
      <rect x="15" y="0.5" width="2" height="4" rx="1" fill="#1565C0" />

      {/* Yellow accent – bottom-left */}
      <path d="M1.5 19 L1.5 20 Q1.5 23 4.5 23 L6 23 L6 19 Z" fill="#FBBC04" />

      {/* Green accent – bottom-right */}
      <path d="M18 19 L18 23 L19.5 23 Q22.5 23 22.5 20 L22.5 19 Z" fill="#34A853" />

      {/* "31" numeral */}
      <text
        x="12"
        y="19"
        textAnchor="middle"
        fontFamily="'Google Sans', 'Roboto', Arial, sans-serif"
        fontSize="9"
        fontWeight="700"
        fill="#4285F4"
      >31</text>

      {/* Red dot on top-right pin */}
      <circle cx="21" cy="2.5" r="2" fill="#EA4335" />
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
