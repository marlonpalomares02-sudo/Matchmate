# MatchMate - Google Ads Keyword Tool

A powerful Chrome extension for Google Ads that enhances keyword research and management capabilities within Google Keyword Planner.

## Features

### Core Functionality
- **Keyword Detection**: Automatically detects keywords from Google Keyword Planner
- **Smart Selection**: Capture keywords using multiple methods:
  - Text selection (highlight and right-click)
  - Double-click on any keyword
  - Checkbox selection (new: captures keyword from next row)
  - Bulk selection support

### Advanced Keyword Capture
- **Next-Row Capture**: When checking a checkbox in Google Keyword Planner, automatically captures the keyword from the row immediately following the checked one
- **Visual Feedback**: Real-time highlighting and confirmation when keywords are captured
- **Bulk Operations**: Handle multiple keyword selections efficiently

### Match Type Management
- **Instant Conversion**: Convert keywords between broad, phrase, and exact match types
- **Bulk Processing**: Apply match type changes to entire keyword lists
- **Smart Formatting**: Automatic capitalization and duplicate removal

### AI-Powered Features
- **Keyword Suggestions**: Get AI-generated keyword suggestions based on your current list
- **Keyword Rewriting**: Enhance and optimize your keywords with AI assistance
- **Ad Group Expansion**: Automatically expand ad groups with relevant keywords

### Import/Export
- **CSV Support**: Import and export keyword lists in CSV format
- **Clipboard Integration**: Copy keywords directly to clipboard
- **Settings Persistence**: Save and load custom settings

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. The extension icon will appear in your Chrome toolbar

## Usage

### Google Keyword Planner Integration
1. Navigate to Google Keyword Planner
2. Search for keywords or view your keyword lists
3. Use any of these methods to capture keywords:
   - **Checkbox Method**: Check any checkbox to capture the keyword from the next row
   - **Selection Method**: Highlight text and right-click → "Add to MatchMate"
   - **Double-click Method**: Double-click any keyword to add it

### Extension Popup
1. Click the MatchMate icon in Chrome toolbar
2. View and manage your captured keywords
3. Use the toolbar buttons to:
   - Convert match types
   - Remove duplicates
   - Apply filters
   - Get AI suggestions
   - Export your keyword list

### Settings
Access the settings panel to customize:
- Default match type
- Auto-capitalization preferences
- Filter rules
- AI integration settings

## Technical Details

### Architecture
- **Content Script** (`content.js`): Handles keyword detection and page interaction
- **Background Script** (`background.js`): Manages storage and cross-tab communication
- **Popup Interface** (`popup.html`, `popup.js`): Provides the main user interface
- **AI Integration**: DeepSeek API for intelligent keyword processing

### Error Handling
The extension includes robust error handling for:
- Connection issues between extension components
- Page loading delays
- Google Keyword Planner interface changes
- API connectivity issues

## Recent Updates

### Version 1.1.0
- Added next-row keyword capture functionality
- Enhanced error handling for extension communication
- Improved checkbox observer for dynamic content
- Added visual feedback for keyword capture

## Troubleshooting

### Common Issues
- **Extension not responding**: Refresh the Google Keyword Planner page
- **Keywords not appearing**: Check if the extension has proper permissions
- **Connection errors**: Ensure the extension is enabled and Google Keyword Planner is loaded

### Debug Mode
Enable debug logging in settings to see detailed console output for troubleshooting.

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Test thoroughly with Google Keyword Planner
4. Submit a pull request

## License

This extension is provided as-is for educational and commercial use. Please respect Google's terms of service when using with Google Ads.