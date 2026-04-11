# BNY App - Tools & Libraries Overview

This document provides a comprehensive overview of all tools, libraries, and frameworks currently being used in the BNY application.

---

## Core Framework & Runtime

### Next.js ^16.2.3

- **Purpose**: React framework for production-grade web applications
- **Usage**: Server-side rendering, API routes, static generation, file-based routing
- **Key Files**: `next.config.ts`, `app/` directory structure
- **Features Used**:
  - App Router (app directory)
  - API routes (`app/api/`)
  - Server Components
  - Image optimization (`next/image`)
  - Font optimization (`next/font`)

### React ^19.2.4

- **Purpose**: JavaScript library for building user interfaces
- **Version**: Latest stable (19.2.4)
- **Usage**: Component-based UI development
- **Key Features**: Hooks, Server Components support

### React DOM ^19.2.4

- **Purpose**: React package for working with the DOM
- **Usage**: Renders React components to the browser
- **Mount Point**: `<body>` in `app/layout.tsx`

### TypeScript ^5

- **Purpose**: Static type checking for JavaScript
- **Config**: `tsconfig.json`
- **Usage**: Type-safe development across all `.tsx` and `.ts` files
- **Dev Dependency**: Yes

---

## Authentication & Identity

### Clerk (@clerk/nextjs ^7.0.12)

- **Purpose**: Complete authentication and user management platform
- **Key Components**:
  - `ClerkProvider`: Root provider in `app/layout.tsx`
  - `SignInButton`: Sign-in modal trigger
  - `SignUpButton`: Sign-up modal trigger
  - `UserButton`: User profile dropdown
  - `Show`: Conditional rendering based on auth state
- **Configuration**: Integrated with shadcn theme in layout
- **Usage Locations**:
  - `app/layout.tsx`: Provider setup
  - `components/general/header.tsx`: Auth UI components
  - `app/api/webhooks/clerk/route.ts`: Webhook handler for syncing users

### Clerk UI (@clerk/ui ^1.5.0)

- **Purpose**: Pre-built UI components for Clerk authentication
- **Usage**: `shadcn` theme integration for styled sign-in/sign-up flows
- **Location**: `app/layout.tsx`

---

## Database & Backend

### Supabase (@supabase/supabase-js ^2.103.0)

- **Purpose**: Open-source Firebase alternative - PostgreSQL database + APIs
- **Key Functions**: Database operations, real-time subscriptions
- **Config**: Uses environment variables
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- **Setup File**: `lib/supabase/client.ts`

### Supabase SSR (@supabase/ssr ^0.10.2)

- **Purpose**: Supabase client optimized for server-side rendering
- **Usage**: Server-side database operations
- **Key Files**:
  - `lib/supabase/server.ts`: Server client
  - `lib/supabase/client.ts`: Browser client
  - `lib/supabase/auth-helpers.ts`: Authentication helpers
  - `lib/supabase/proxy.ts`: Request proxying

---

## Data Fetching & State Management

### TanStack React Query (@tanstack/react-query ^5.97.0)

- **Purpose**: Powerful data synchronization and caching library
- **Features**:
  - Server state management
  - Automatic caching and deduplication
  - Background refetching
  - Optimistic updates
- **Usage**: Client-side data fetching and synchronization
- **Configuration**: Typically wrapped in a QueryClientProvider at root

### TanStack React Query DevTools (@tanstack/react-query-devtools ^5.97.0)

- **Purpose**: Developer tools for debugging React Query
- **Usage**: Development-only debugging and inspection
- **Dev Dependency**: Yes
- **Features**: Query state inspection, refetch, invalidate, reset

---

## UI Components & Styling

### shadcn (@4.2.0)

- **Purpose**: Re-usable component library built on Radix UI and Tailwind CSS
- **Usage**: Pre-built, accessible UI components
- **Theme Integration**: `shadcn` theme from `@clerk/ui` used in Clerk setup
- **Component Examples**: Button, Input, Card, Dialog, etc.

### Radix UI (@1.4.3)

- **Purpose**: Low-level, unstyled, accessible component primitives
- **Dependency Of**: shadcn components
- **Features**: Accessibility (a11y), keyboard navigation, ARIA attributes

### Tailwind CSS (^4)

- **Purpose**: Utility-first CSS framework
- **Config Files**:
  - `tailwind.config.js`
  - `postcss.config.mjs`
- **Setup**: `@tailwindcss/postcss` for PostCSS integration
- **Dev Dependency**: Yes
- **Usage**: Style components with utility classes throughout the app

### @tailwindcss/postcss (^4)

- **Purpose**: Tailwind CSS v4 PostCSS plugin
- **Dev Dependency**: Yes
- **Usage**: CSS preprocessor for Tailwind

### clsx (^2.1.1)

- **Purpose**: Utility for constructing classNames conditionally
- **Usage**: Dynamic CSS class combinations
- **Example**: Conditional styling based on props

### tailwind-merge (^3.5.0)

- **Purpose**: Merge Tailwind CSS classes without conflicts
- **Usage**: Combine Tailwind classes from different sources
- **Common Pattern**: Used with shadcn components for class override

---

## Icons & Typography

### lucide-react (^1.8.0)

- **Purpose**: Beautiful, consistent icon library
- **Format**: React components
- **Usage**: SVG icons throughout the UI
- **Examples**: Navigation icons, action icons, status indicators

### Geist Font (from next/font/google)

- **Purpose**: Vercel's custom typeface
- **Variants Used**:
  - `Geist` (sans-serif): Main font (`--font-geist-sans`)
  - `Geist_Mono` (monospace): Code font (`--font-geist-mono`)
- **Location**: `app/layout.tsx`
- **CSS Variables**: `--font-geist-sans`, `--font-geist-mono`

---

## Design System & Utilities

### class-variance-authority (^0.7.1)

- **Purpose**: Type-safe CSS class variant composition
- **Usage**: Define component variants with TypeScript
- **Common Pattern**: Used in shadcn components for configurable styling
- **Example**: Button variants (primary, secondary, small, large)

### tw-animate-css (^1.4.0)

- **Purpose**: Tailwind CSS animation utilities
- **Usage**: Add animations and transitions to components

---

## Webhooks & Events

### Svix (^0.x - installed via Clerk)

- **Purpose**: Webhook delivery and verification service
- **Key Export**: `Webhook` class for signature verification
- **Usage**: Verify Clerk webhook signatures
- **Location**: `app/api/webhooks/clerk/route.ts`
- **Security**: HMAC signature verification with `CLERK_WEBHOOK_SECRET`

---

## Development & Code Quality

### ESLint (^9)

- **Purpose**: JavaScript/TypeScript linter for code quality
- **Config**: `eslint.config.mjs`
- **Related**: `eslint-config-next` (^16.2.3) for Next.js-specific rules
- **Command**: `npm run lint`

### TypeScript (^5)

- **Purpose**: Static type checking and type safety
- **Config**: `tsconfig.json`
- **Type Packages**:
  - `@types/node` (^20): Node.js type definitions
  - `@types/react` (^19): React type definitions
  - `@types/react-dom` (^19): React DOM type definitions

---

## Environment & Build Configuration

### next.config.ts

- **Purpose**: Next.js configuration
- **Typical Settings**: Webpack config, environment variables, API proxy settings

### tsconfig.json

- **Purpose**: TypeScript compiler configuration
- **Path Aliases**: `@/*` pointing to project root

### components.json

- **Purpose**: shadcn component configuration
- **Usage**: Store component preferences and component library settings

### postcss.config.mjs

- **Purpose**: PostCSS configuration
- **Plugins**: Tailwind CSS plugin

### tailwind.config.js

- **Purpose**: Tailwind CSS configuration
- **Usage**: Custom colors, fonts, breakpoints, plugins

---

## Project Scripts

```json
{
  "dev": "next dev", // Start development server
  "build": "next build", // Build for production
  "start": "next start", // Start production server
  "lint": "eslint" // Run ESLint
}
```

---

## File Structure & Key Locations

```
app/                           // Next.js App Router
├── layout.tsx               // Root layout (ClerkProvider, Header)
├── page.tsx                 // Home page
├── globals.css              // Global styles
└── api/
    └── webhooks/
        └── clerk/
            └── route.ts     // Clerk webhook handler

components/
├── general/
│   └── header.tsx          // Auth header with Clerk components
└── ui/
    └── button.tsx          // shadcn Button component

lib/
├── utils.ts                // Shared utilities
└── supabase/
    ├── client.ts           // Browser Supabase client
    ├── server.ts           // Server Supabase client
    ├── auth-helpers.ts     // Auth utilities
    └── proxy.ts            // Request proxy
```

---

## Integration Patterns

### Authentication Flow

```
User → ClerkProvider → Clerk UI Components → Webhook → Supabase User Sync
```

### Data Fetching Flow

```
React Component → TanStack React Query → Supabase Client → PostgreSQL
```

### Styling Pipeline

```
Components → Tailwind Classes → PostCSS → CSS Output
```

---

## Version Summary

| Tool           | Version  | Type       |
| -------------- | -------- | ---------- |
| Next.js        | ^16.2.3  | Framework  |
| React          | ^19.2.4  | Framework  |
| TypeScript     | ^5       | Dev Tool   |
| Clerk          | ^7.0.12  | Dependency |
| Supabase       | ^2.103.0 | Dependency |
| TanStack Query | ^5.97.0  | Dependency |
| Tailwind CSS   | ^4       | Styling    |
| ESLint         | ^9       | Dev Tool   |

---

## Resources & Documentation

- [Next.js Documentation](https://nextjs.org/docs)
- [Clerk Documentation](https://clerk.com/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [TanStack React Query](https://tanstack.com/query/latest)
- [shadcn/ui](https://ui.shadcn.com)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [TypeScript](https://www.typescriptlang.org/docs)

---

**Last Updated**: April 11, 2026
**App Version**: 0.1.0
