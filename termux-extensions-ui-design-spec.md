# Termux Extensions UI Design Specification

## Color Palette & Design Tokens

### Primary Color Scheme (Dark Theme)
```css
:root {
  --background: hsl(224, 71%, 4%)           /* Deep navy blue background */
  --foreground: hsl(213, 31%, 91%)          /* Light gray text */
  --card: hsl(224, 71%, 7%)                 /* Slightly lighter navy for cards */
  --card-foreground: hsl(213, 31%, 91%)     /* Light gray text on cards */
  --popover: hsl(224, 71%, 7%)              /* Navy for popover backgrounds */
  --popover-foreground: hsl(213, 31%, 91%)  /* Light gray popover text */
  --primary: hsl(217, 91%, 60%)             /* Bright blue accent */
  --primary-foreground: hsl(222, 84%, 5%)   /* Dark text on primary */
  --secondary: hsl(222, 84%, 11%)           /* Dark secondary background */
  --secondary-foreground: hsl(213, 31%, 91%) /* Light text on secondary */
  --muted: hsl(223, 47%, 11%)               /* Muted background */
  --muted-foreground: hsl(215, 13%, 65%)    /* Muted text */
  --accent: hsl(216, 87%, 52%)              /* Blue accent color */
  --accent-foreground: hsl(222, 84%, 5%)    /* Dark text on accent */
  --destructive: hsl(0, 63%, 31%)           /* Red for destructive actions */
  --destructive-foreground: hsl(210, 40%, 98%) /* Light text on destructive */
  --border: hsl(216, 34%, 17%)              /* Border color */
  --input: hsl(216, 34%, 17%)               /* Input field borders */
  --ring: hsl(216, 87%, 52%)                /* Focus ring color */
  --success: hsl(142, 69%, 45%)             /* Green success color */
  --warning: hsl(38, 92%, 50%)              /* Orange warning color */
}
```

### Typography
- **Primary Font**: 'Inter', 'Segoe UI', sans-serif
- **Monospace Font**: 'JetBrains Mono', 'Courier New', monospace
- **Font Loading**: Google Fonts (weights: 300, 400, 500, 600, 700)

## Layout Architecture

### Main Container Structure
- **Full screen overlay**: `min-h-screen overflow-hidden bg-background`
- **Background gradient**: `bg-gradient-to-br from-slate-900 to-slate-800`
- **Fixed positioning**: All overlay elements use `fixed` positioning
- **Z-index hierarchy**: 
  - Backdrop: `z-40`
  - Drawer handle: `z-50`
  - Main drawer: `z-50`
  - File manager sheet: `z-60`

## Drawer System

### Main Drawer (320px width)
```css
width: 320px (w-80)
height: 100vh
position: fixed
top: 0
right: 0
background: var(--card)
border-left: 1px solid var(--border)
```

#### Drawer States & Animation
- **Closed State**: `translate-x-full` (100% off-screen to the right)
- **Open State**: `translate-x-0` (visible)
- **Transition**: `transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)`

#### Drawer Handle
- **Position**: `right: -2px, top: 50%, transform: translateY(-50%)`
- **Dimensions**: `width: 4px, height: 60px`
- **Styling**: `border-radius: 2px 0 0 2px`
- **Color**: `background: var(--primary), opacity: 0.7`
- **Hover Effect**: `opacity: 1`

### File Manager Sheet (320px width)
- **Overlays main drawer**: Slides over from the right
- **Same width**: 320px (w-80)
- **Animation**: Custom CSS class `.file-manager-sheet`
- **Closed**: `transform: translateX(100%)`
- **Open**: `transform: translateX(0)`

## Component Breakdown

### System Stats Header (Grid Layout)
```css
display: grid
grid-template-columns: repeat(2, 1fr)
gap: 12px (gap-3)
```

#### Individual Stat Cards
- **Background**: `var(--card)`
- **Padding**: `12px (p-3)`
- **Border**: `1px solid var(--border)`
- **Border Radius**: `6px (rounded-md)`
- **Typography**: `text-sm` for labels, `text-xs font-mono` for values

#### Progress Bars
- **Container**: `width: 100%, height: 6px, border-radius: 9999px`
- **Background**: `var(--muted)`
- **Fill Colors**:
  - CPU: `var(--accent)` (blue)
  - Memory: `var(--warning)` (orange)
- **Animation**: `transition: width 0.5s ease-in-out`

#### Status Indicators
- **Dot Size**: `width: 6px, height: 6px`
- **Shape**: `border-radius: 50%`
- **Colors**:
  - Connected/Active: `var(--success)` (green)
  - Disconnected/Inactive: `var(--destructive)` (red)
  - Network: `var(--success)` (green)

### Container Status Pills
- **Running Containers**:
  - Background: `rgba(success, 0.1)` (success/10)
  - Border: `rgba(success, 0.2)` (success/20)
  - Text: `var(--success)`
- **Stopped Containers**:
  - Background: `var(--muted)`
  - Border: `var(--border)`
  - Text: `var(--muted-foreground)`
- **Typography**: `text-xs font-mono`
- **Padding**: `8px 8px (px-2 py-1)`

### Command Shortcuts Grid
```css
display: grid
grid-template-columns: repeat(2, 1fr)
gap: 8px (gap-2)
```

#### Shortcut Buttons
- **Base Style**: `variant="secondary"`
- **Background**: `var(--secondary)`
- **Hover**: `rgba(secondary, 0.8)`
- **Border**: `1px solid var(--border)`
- **Text**: `var(--secondary-foreground)`
- **Padding**: `12px (px-3 py-2)`
- **Typography**: `text-xs font-medium`
- **Alignment**: `text-left justify-start`
- **Height**: `height: auto (h-auto)`

#### Icon Styling
- **Size**: `12px (h-3 w-3)`
- **Margin**: `4px right (mr-1)`
- **Colors**:
  - Primary: `var(--primary)`
  - Accent: `var(--accent)`
  - Success: `var(--success)`
  - Warning: `var(--warning)`

### Sessions Panel
#### Session Cards
- **Background**: `rgba(secondary, 0.5)` (secondary/50)
- **Border**: `1px solid var(--border)`
- **Border Radius**: `6px (rounded-md)`
- **Padding**: `8px (p-2)`
- **Spacing**: `8px between cards (space-y-2)`

#### Session Information Layout
- **Title Row**: Flex layout with space-between
- **Title Typography**: `text-xs font-medium font-mono`
- **PID Display**: `text-xs text-accent font-mono`
- **Status Indicators**: 6px status dots
- **Metadata**: `text-xs text-muted-foreground font-mono`

### File Manager Interface

#### Header Section
- **Background**: `var(--secondary)`
- **Padding**: `16px (p-4)`
- **Border**: `1px solid var(--border)` (bottom only)

#### Root Selector Buttons
- **Active State**: `variant="default"` (primary styling)
- **Inactive State**: `variant="secondary"`
- **Size**: `size="sm"`
- **Spacing**: `8px gap (gap-2)`

#### Path Breadcrumb
- **Typography**: `text-xs text-muted-foreground font-mono`
- **Refresh Button**: `variant="ghost" size="sm"`
- **Icon Size**: `12px (h-3 w-3)`

#### File List Items
- **Container**: Flex layout with hover effects
- **Hover**: `rgba(muted, 0.5)` (muted/50)
- **Padding**: `8px (p-2)`
- **Border Radius**: `6px (rounded-md)`
- **Transition**: `transition-colors`

#### File Icons
- **Size**: `16px (h-4 w-4)`
- **Colors**:
  - Directories: `var(--primary)`
  - Scripts (.sh, .py): `var(--accent)`
  - Files: `var(--muted-foreground)`

#### File Information
- **Filename**: `text-sm font-medium`
- **Metadata**: `text-xs text-muted-foreground font-mono`
- **Permissions**: Displayed for files only
- **File Size**: Human-readable format (B, KB, MB, GB)
- **Last Modified**: Relative time format (e.g., "2h ago")

#### Action Dropdown
- **Trigger**: `variant="ghost" size="sm"`
- **Visibility**: `opacity-0 group-hover:opacity-100`
- **Icon**: `MoreHorizontal` (16px)
- **Animation**: `transition-all`

### Upload Area
- **Container**: Dashed border design
- **Border**: `2px dashed var(--border)`
- **Hover Effect**: `border-primary/50`
- **Padding**: `16px (p-4)`
- **Alignment**: `text-center`
- **Upload Icon**: `32px (h-8 w-8)`
- **Color**: `var(--muted-foreground)`

## Interactive Elements

### Button Variants
1. **Primary**: Blue background, dark text
2. **Secondary**: Dark background, light text  
3. **Ghost**: Transparent background, hover effects
4. **Outline**: Border only, transparent background

### Button Sizes
- **Small**: `size="sm"` - Reduced padding and text
- **Default**: Standard size
- **Large**: Increased padding and text

### Hover Effects
- **Buttons**: Background color changes (typically 80% opacity)
- **File Items**: Background becomes `muted/50`
- **Cards**: Subtle shadow or background shift
- **Icons**: Opacity or color changes

## Responsive Design

### Mobile Optimizations
- **Touch Targets**: Minimum 44px for interactive elements
- **Swipe Gestures**:
  - Right edge detection: `startX > window.innerWidth - 50`
  - Swipe threshold: `deltaX > 50, deltaY < 100`
- **Drawer Width**: Fixed 320px (may scroll on smaller screens)

### Keyboard Shortcuts
- **Escape**: Close file manager or drawer
- **Ctrl+Shift+T**: Toggle drawer
- **Tab Navigation**: Standard focus management

## Animations & Transitions

### Drawer Animations
```css
.drawer-transition {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
```

### Progress Bar Animations
```css
.cpu-bar, .memory-bar {
  transition: width 0.5s ease-in-out;
}
```

### Backdrop Effect
```css
.overlay-backdrop {
  backdrop-filter: blur(2px);
  background: rgba(0, 0, 0, 0.3);
}
```

### Custom Scrollbars
```css
.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: hsl(216, 34%, 25%) transparent;
}

.scrollbar-thin::-webkit-scrollbar {
  width: 6px;
}

.scrollbar-thin::-webkit-scrollbar-thumb {
  background: hsl(216, 34%, 25%);
  border-radius: 3px;
}
```

## Component Hierarchy

### Main Dashboard
```
Dashboard
├── Background (gradient)
├── Overlay Backdrop (when drawer open)
├── Drawer Handle (always visible)
├── Connection Status Indicator
├── Main Drawer
│   ├── System Stats Header
│   ├── Container Status
│   ├── Shortcuts Panel
│   ├── Sessions Panel
│   └── Quick Actions
└── File Manager Sheet (overlay)
    ├── Header (root selector + breadcrumb)
    ├── File List (scrollable)
    └── Upload Area
```

## Data Display Patterns

### Real-time Updates
- **WebSocket Connection**: Updates every 2 seconds
- **Loading States**: Skeleton animations for missing data
- **Error States**: Destructive color scheme
- **Success States**: Success color scheme

### Empty States
- **No Sessions**: Centered message with instructions
- **No Files**: Directory listing shows parent navigation
- **Connection Lost**: Status indicator changes to red

## Accessibility Features

### ARIA Labels & Test IDs
- All interactive elements have `data-testid` attributes
- Semantic HTML structure
- Focus management for keyboard navigation
- Color contrast compliance (dark theme optimized)

### Screen Reader Support
- Proper heading hierarchy
- Status announcements for dynamic content
- Button labels and descriptions
- Progress bar accessibility

## Design Philosophy

### Minimalist Terminal Aesthetic
- Dark color scheme inspired by terminal applications
- Monospace fonts for technical information
- Minimal shadows and effects
- High contrast for readability

### Mobile-First Approach
- Touch-friendly interface design
- Gesture-based navigation
- Optimized for overlay usage
- Efficient use of screen space

### Performance Considerations
- Hardware acceleration for animations
- Efficient WebSocket usage (2s intervals)
- Lazy loading for file operations
- Minimal DOM manipulation

This design system creates a cohesive, professional interface that balances technical functionality with modern UI patterns, specifically optimized for mobile overlay usage while maintaining desktop compatibility.