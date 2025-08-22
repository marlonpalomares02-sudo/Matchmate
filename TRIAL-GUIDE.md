# MatchMate Trial System Guide

## Overview
MatchMate includes a 7-day trial system that automatically locks the extension interface after the trial period expires.

## How It Works

### Trial Tracking
- **Installation Date**: Stored in browser's localStorage when extension is first used
- **Trial Duration**: 7 days from installation
- **Automatic Lock**: Interface becomes locked when trial expires

### User Experience
1. **Day 1-4**: Full functionality, no restrictions
2. **Day 5-7**: Warning badge appears showing remaining days
3. **Day 8+**: Trial overlay blocks all functionality with upgrade prompt

### Visual Indicators
- **Warning Badge**: Shows "X days left" when 3 days or less remain
- **Color Coding**: 
  - Yellow: 3 days remaining
  - Orange: 2 days remaining  
  - Red: 1 day remaining
- **Trial Overlay**: Complete lock screen with upgrade button

## For Developers

### Testing the Trial System

#### Reset Trial (Development Only)
Open the browser console on the extension popup and run:
```javascript
matchMate.resetTrial();
```

#### Check Trial Status
```javascript
// Check remaining days
matchMate.trialManager.getDaysRemaining();

// Check if trial is expired
matchMate.trialManager.isTrialExpired();

// Get installation date
matchMate.trialManager.getInstallationDate();
```

#### Simulate Expired Trial
To test the locked interface:
1. Install the extension
2. Wait 7 days, OR
3. Manually set an old installation date:
```javascript
const oldDate = new Date();
oldDate.setDate(oldDate.getDate() - 8);
localStorage.setItem('matchmate_install_date', oldDate.toISOString());
location.reload();
```

### Trial Configuration
Modify trial duration in `popup.js`:
```javascript
// In TrialManager class
this.TRIAL_DAYS = 7; // Change to desired trial length
```

### Customization Options

#### Upgrade URL
Change the upgrade button destination in `popup.html`:
```html
<button class="btn btn-upgrade" onclick="window.open('YOUR_URL_HERE', '_blank')">
```

#### Trial Message
Customize the trial overlay text in `popup.html` within the `#trialOverlay` div.

#### Styling
Modify trial-related CSS in `popup.css` under "Trial Overlay Styles" section.

## File Structure
- **Trial Logic**: `popup.js` (TrialManager class)
- **Trial UI**: `popup.html` (#trialOverlay)
- **Styling**: `popup.css` (Trial Overlay Styles section)

## Resetting for Production
To disable trial system for production:
1. Remove trial check from `init()` method
2. Remove trial overlay from `popup.html`
3. Remove trial-related CSS

## Local Storage Keys
- `matchmate_install_date`: Installation timestamp
- `matchmate_trial_expired`: Flag for expired trial (future use)