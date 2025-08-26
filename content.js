// MatchMate for Google Ads - Content Script
// This script runs on Google Ads pages to help detect keywords

(function() {
    'use strict';

    // Listen for messages from the popup or background script with better error handling
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            try {
                if (request.action === 'detectKeywords') {
                    const keywords = detectKeywordsFromPage();
                    sendResponse({ keywords: keywords });
                } else if (request.action === 'highlightKeyword') {
                    highlightElement(request.keyword, request.highlight);
                    sendResponse({ success: true });
                } else if (request.action === 'highlightKeywords') {
                    // This handles the broadcast from a paste action
                    request.keywords.forEach(keyword => {
                        highlightElement(keyword, true);
                    });
                    sendResponse({ success: true });
                } else if (request.action === 'ping') {
                    // Health check from popup/background
                    sendResponse({ success: true, ready: true });
                } else if (request.action === 'getSelectedKeywords') {
                    // Return currently selected keywords
                    const selected = Array.from(selectedKeywords.values()).map(k => ({
                        keyword: k.cleanKeyword,
                        isNegative: k.isNegative,
                        contextData: k.contextData
                    }));
                    sendResponse({ success: true, selected });
                } else if (request.action === 'clearSelection') {
                    clearSelection();
                    sendResponse({ success: true });
                } else if (request.action === 'addSelectedKeywords') {
                    addAllSelectedKeywords();
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'Unknown action' });
                }
            } catch (error) {
                console.error('Error handling message in content script:', error);
                sendResponse({ success: false, error: error.message });
            }
            return true; // Keep channel open for async responses
        });
    } else {
        console.warn('Chrome extension APIs not available, skipping message listener setup');
    }

    // Function to highlight a keyword
    function highlightElement(keyword, highlight = true) {
        // First, remove any existing highlights to prevent duplicates or errors
        const existingHighlights = document.querySelectorAll('span.matchmate-highlight');
        existingHighlights.forEach(span => {
            const parent = span.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(span.textContent), span);
                parent.normalize(); // Merges adjacent text nodes
            }
        });

        if (!highlight) {
            return; // Exit if we only wanted to remove highlights
        }

        const regex = new RegExp(escapeRegExp(keyword), 'gi');
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        const nodesToReplace = [];

        // First pass: find all text nodes that contain the keyword
        let currentNode;
        while (currentNode = walker.nextNode()) {
            if (regex.test(currentNode.nodeValue)) {
                // Ensure we are not inside a script, style, or already highlighted element
                if (!currentNode.parentElement.closest('script, style, .matchmate-highlight')) {
                    nodesToReplace.push(currentNode);
                }
            }
        }

        // Second pass: replace the content of the found nodes
        nodesToReplace.forEach(node => {
            const parent = node.parentNode;
            const parts = node.nodeValue.split(regex);
            
            // Create a document fragment to hold the new nodes
            const fragment = document.createDocumentFragment();
            parts.forEach((part, index) => {
                if (index % 2 === 1) { // This is the matched keyword
                    const span = document.createElement('span');
                    span.className = 'matchmate-highlight';
                    span.dataset.keyword = keyword; // Add data attribute
                    span.style.backgroundColor = 'rgba(255, 255, 0, 0.3)'; // Light yellow overlay
                    span.textContent = part;
                    fragment.appendChild(span);
                } else if (part) { // This is the text before or after
                    fragment.appendChild(document.createTextNode(part));
                }
            });
            
            // Replace the original text node with the new fragment
            if (parent) {
                parent.replaceChild(fragment, node);
            }
        });
    }

    // Helper function to escape regex special characters
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Global state to prevent duplicate event listeners
    let eventListenersAdded = false;
    
    // Single mouseup event listener for text selection
    function addTextSelectionListener() {
        if (eventListenersAdded) return;
        eventListenersAdded = true;
        
        document.addEventListener('mouseup', handleMouseUp);
    }
    
    function handleMouseUp(event) {
        const selectedText = window.getSelection().toString().trim();
        
        // Check if the selection is a valid keyword and not just whitespace
        if (selectedText && selectedText.length > 2) {
            // Handle multiple keywords from text selection
            handleTextSelection(selectedText, window.getSelection());
        }
    }

    // Function to add or remove a keyword and its highlight
    function toggleKeyword(keyword, force) {
        const isHighlighted = document.querySelector(`span.matchmate-highlight[data-keyword="${keyword}"]`) !== null;
        const shouldHighlight = force === undefined ? !isHighlighted : force;

        highlightElement(keyword, shouldHighlight);

        if (shouldHighlight) {
            sendMessageWithRetry({ action: 'addKeyword', keyword: keyword }).catch(err => {
                console.log('Extension communication failed:', err.message);
            });
        } else {
            sendMessageWithRetry({ action: 'removeKeyword', keyword: keyword }).catch(err => {
                console.log('Extension communication failed:', err.message);
            });
        }
    }

    // Enhanced double-click handler with smart boundaries
    document.addEventListener('dblclick', (event) => {
        const target = event.target;
        let keyword = getSmartKeywordFromElement(target);
        
        if (keyword && isValidKeyword(keyword)) {
            console.log('Smart double-clicked keyword:', keyword);
            const keywordData = new KeywordData(keyword, target);
            keywordData.source = 'smart_double_click';
            
            // Visual feedback for double-click capture
            highlightSmartBoundary(target, keyword);
            
            toggleKeyword(keyword);
            showQuickFeedback(`Double-click captured: "${keyword}"`, 'success');
        }
    });

    function getSmartKeywordFromElement(element) {
        // Try to get keyword with smart boundary detection
        let keyword = null;
        
        // Method 1: Direct text content if it's a keyword element
        if (element.matches('[data-test-id*="keyword"], .keyword-text, .kw-text')) {
            keyword = element.textContent?.trim();
        }
        
        // Method 2: Check if we're in a table cell
        if (!keyword) {
            const cell = element.closest('td, th');
            if (cell) {
                keyword = cell.textContent?.trim();
            }
        }
        
        // Method 3: Text selection with smart boundaries
        if (!keyword) {
            const selection = window.getSelection();
            if (selection.toString().trim()) {
                keyword = selection.toString().trim();
            }
        }
        
        // Method 4: Smart text extraction from surrounding context
        if (!keyword) {
            keyword = extractKeywordFromContext(element);
        }
        
        return keyword && keyword.length > 1 && keyword.length < 100 ? keyword : null;
    }

    function extractKeywordFromContext(element) {
        const text = element.textContent || element.innerText || '';
        
        // Split by common delimiters and find the most likely keyword
        const parts = text.split(/[\n\t\r,;|]/).map(p => p.trim()).filter(p => p);
        
        // Return the first valid keyword-like part
        for (const part of parts) {
            if (isValidKeyword(part)) {
                return part;
            }
        }
        
        return null;
    }

    function highlightSmartBoundary(element, keyword) {
        // Temporarily highlight the captured boundary
        const originalStyle = element.style.cssText;
        element.style.cssText += `
            outline: 2px solid #4caf50 !important;
            outline-offset: 2px !important;
            background-color: rgba(76, 175, 80, 0.1) !important;
        `;
        
        setTimeout(() => {
            element.style.cssText = originalStyle;
        }, 1000);
    }


    // Event listener for checkbox changes
    document.addEventListener('change', (event) => {
        const checkbox = event.target;
        if (checkbox.tagName !== 'INPUT' || checkbox.type !== 'checkbox') {
            return;
        }

        // Find the table row containing the checkbox
        const row = checkbox.closest('tr');
        if (!row) {
            return;
        }

        // Find the NEXT table row to get the keyword immediately following the checked one
        const nextRow = row.nextElementSibling;
        if (!nextRow || nextRow.tagName !== 'TR') {
            return;
        }

        // Find the keyword text within the NEXT row
        // Google Keyword Planner often uses a specific data-test-id for the keyword text
        const keywordElement = nextRow.querySelector('[data-test-id="keyword-text"], .keyword-text, [data-test-id="keyword-idea-text"]');
        
        if (keywordElement) {
            const keyword = keywordElement.textContent?.trim();
            if (keyword && isValidKeyword(keyword)) {
                console.log('Checkbox keyword captured (next row):', keyword, 'Checked:', checkbox.checked);
                toggleKeyword(keyword, checkbox.checked);
            }
        }
    });



    function handleTextSelection(selectedText, selection) {
        // Split selected text by newlines, commas, or semicolons to handle multiple keywords
        const keywords = extractKeywordsFromSelection(selectedText);
        
        if (keywords.length > 0) {
            console.log('Multiple keywords selected via highlighting:', keywords);
            
            // Apply yellow highlighting to the selected text
            applyYellowHighlighting(selection, keywords);
            
            // Auto-capture all selected keywords with enhanced data
            keywords.forEach((keyword, index) => {
                // Add delay between captures to prevent overwhelming the background script
                setTimeout(() => {
                    const keywordData = new KeywordData(keyword);
                    keywordData.source = 'text_selection';
                    addKeywordToSelection(keywordData);
                    
                    // Also send to MatchMate interface with better error handling
                    sendMessageWithRetry({ 
                        action: 'addKeyword', 
                        keyword: keyword,
                        keywordData: keywordData,
                        isNegative: keywordData.isNegative
                    }).then(() => {
                        console.log(`Successfully added keyword: ${keyword}`);
                    }).catch(err => {
                        console.log(`Failed to add keyword ${keyword}:`, err.message);
                        showQuickFeedback(`Failed to add "${keyword}"`, 'warning');
                    });
                }, index * 50); // 50ms delay between each keyword
            });
            
            // Show visual feedback
            showSelectionFeedback(keywords.length);
        }
    }

    function extractKeywordsFromSelection(selectedText) {
        // Split by various delimiters commonly found in keyword lists
        const delimiters = /[\n\r,;\t|]+/;
        const potentialKeywords = selectedText.split(delimiters)
            .map(k => k.trim())
            .filter(k => k && isValidKeywordFromSelection(k));
        
        // If no delimiters found, treat the entire selection as potential keyword
        if (potentialKeywords.length === 0 && isValidKeywordFromSelection(selectedText)) {
            return [selectedText];
        }
        
        // Limit to reasonable number to avoid performance issues
        return potentialKeywords.slice(0, 20);
    }

    function applyYellowHighlighting(selection, keywords) {
        try {
            // Get the range of the selection
            if (selection.rangeCount === 0) return;
            
            const range = selection.getRangeAt(0);
            const selectedElement = range.commonAncestorContainer;
            
            // Create a highlight wrapper
            const highlightWrapper = document.createElement('span');
            highlightWrapper.className = 'matchmate-text-selection-highlight';
            highlightWrapper.style.cssText = `
                background-color: rgba(255, 255, 0, 0.4) !important;
                border-radius: 2px !important;
                padding: 1px 2px !important;
                box-shadow: 0 0 0 1px rgba(255, 255, 0, 0.6) !important;
                position: relative !important;
            `;
            
            // Add data attributes for tracking
            highlightWrapper.dataset.matchmateHighlight = 'text-selection';
            highlightWrapper.dataset.keywords = keywords.join(',');
            highlightWrapper.dataset.timestamp = Date.now();
            
            try {
                // Wrap the selection with highlighting
                range.surroundContents(highlightWrapper);
                
                // Add a small indicator
                addSelectionIndicator(highlightWrapper, keywords.length);
                
                // Auto-remove highlighting after 5 seconds
                setTimeout(() => {
                    removeHighlighting(highlightWrapper);
                }, 5000);
                
            } catch (error) {
                // Fallback: apply highlighting to individual text nodes
                console.log('Fallback highlighting method');
                applyFallbackHighlighting(range, keywords);
            }
            
            // Clear the selection
            selection.removeAllRanges();
            
        } catch (error) {
            console.log('Error applying yellow highlighting:', error);
            // Continue with keyword capture even if highlighting fails
        }
    }

    function addSelectionIndicator(wrapper, keywordCount) {
        const indicator = document.createElement('span');
        indicator.className = 'matchmate-selection-indicator';
        indicator.style.cssText = `
            position: absolute !important;
            top: -8px !important;
            right: -8px !important;
            background: #4caf50 !important;
            color: white !important;
            border-radius: 50% !important;
            width: 16px !important;
            height: 16px !important;
            font-size: 10px !important;
            font-weight: bold !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            z-index: 10000 !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        `;
        indicator.textContent = keywordCount;
        wrapper.appendChild(indicator);
    }

    function applyFallbackHighlighting(range, keywords) {
        // Create a simple highlight span
        const highlight = document.createElement('span');
        highlight.className = 'matchmate-fallback-highlight';
        highlight.style.cssText = `
            background-color: rgba(255, 255, 0, 0.3) !important;
            border-radius: 2px !important;
        `;
        highlight.dataset.keywords = keywords.join(',');
        
        // Extract contents and wrap them
        const contents = range.extractContents();
        highlight.appendChild(contents);
        range.insertNode(highlight);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            removeHighlighting(highlight);
        }, 5000);
    }

    function removeHighlighting(wrapper) {
        try {
            if (wrapper && wrapper.parentNode) {
                // Move all child nodes to parent and remove wrapper
                while (wrapper.firstChild) {
                    wrapper.parentNode.insertBefore(wrapper.firstChild, wrapper);
                }
                wrapper.parentNode.removeChild(wrapper);
                
                // Normalize text nodes
                wrapper.parentNode.normalize();
            }
        } catch (error) {
            console.log('Error removing highlighting:', error);
        }
    }

    // Enhanced visual feedback for text selection
    function showSelectionFeedback(count) {
        const feedback = document.createElement('div');
        feedback.style.cssText = `
            position: fixed;
            top: 50px;
            right: 10px;
            background: linear-gradient(135deg, #ffeb3b, #ffc107);
            color: #333;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 4px 12px rgba(255, 193, 7, 0.3);
            border: 2px solid #ffc107;
            animation: slideInBounce 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        `;
        
        feedback.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">✨</span>
                <span>Captured ${count} keyword${count > 1 ? 's' : ''} from selection!</span>
            </div>
        `;
        
        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideInBounce {
                0% { 
                    opacity: 0; 
                    transform: translateX(100%) scale(0.8); 
                }
                60% { 
                    opacity: 1; 
                    transform: translateX(-10px) scale(1.05); 
                }
                100% { 
                    opacity: 1; 
                    transform: translateX(0) scale(1); 
                }
            }
        `;
        
        document.head.appendChild(style);
        document.body.appendChild(feedback);
        
        setTimeout(() => {
            feedback.style.animation = 'slideOut 0.3s ease-in forwards';
            style.textContent += `
                @keyframes slideOut {
                    to { opacity: 0; transform: translateX(100%) scale(0.8); }
                }
            `;
            
            setTimeout(() => {
                if (feedback.parentNode) feedback.remove();
                if (style.parentNode) style.remove();
            }, 300);
        }, 3000);
    }

    // Cleanup and management functions for text selection highlighting
    function cleanupOldHighlights() {
        // Remove highlights older than 10 seconds
        const highlights = document.querySelectorAll('[data-matchmate-highlight="text-selection"]');
        const currentTime = Date.now();
        
        highlights.forEach(highlight => {
            const timestamp = parseInt(highlight.dataset.timestamp);
            if (currentTime - timestamp > 10000) { // 10 seconds
                removeHighlighting(highlight);
            }
        });
    }

    // Text selection enhancement for better keyword detection
    function enhanceTextSelectionCapture() {
        // Monitor for selection changes
        let selectionTimeout;
        
        document.addEventListener('selectionchange', () => {
            // Debounce selection changes
            clearTimeout(selectionTimeout);
            selectionTimeout = setTimeout(() => {
                const selection = window.getSelection();
                if (selection.toString().trim()) {
                    // Prepare for potential keyword capture
                    prepareSelectionForCapture(selection);
                }
            }, 300);
        });
        
        // Clean up old highlights periodically
        setInterval(cleanupOldHighlights, 5000);
    }

    function prepareSelectionForCapture(selection) {
        const selectedText = selection.toString().trim();
        
        // Only process if it looks like keyword data
        if (selectedText.length > 1 && selectedText.length < 500) {
            // Check if we're in a keyword-relevant area
            const range = selection.getRangeAt(0);
            const container = range.commonAncestorContainer;
            const element = container.nodeType === Node.TEXT_NODE ? 
                container.parentElement : container;
            
            // Look for keyword-related context
            if (isInKeywordContext(element)) {
                // Add visual hint that this selection can be captured
                addSelectionHint(selection);
            }
        }
    }

    function isInKeywordContext(element) {
        // Check if the element or its ancestors contain keyword-related attributes
        const keywordIndicators = [
            '[data-test-id*="keyword"]',
            '.keyword-text',
            '.keyword-idea',
            'table',
            '[role="grid"]',
            '[role="gridcell"]'
        ];
        
        return keywordIndicators.some(selector => 
            element.matches(selector) || element.closest(selector)
        );
    }

    function addSelectionHint(selection) {
        // Add a subtle visual hint that this selection can be captured
        if (selection.rangeCount === 0) return;
        
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        // Create a temporary hint element
        const hint = document.createElement('div');
        hint.className = 'matchmate-selection-hint';
        hint.style.cssText = `
            position: fixed;
            left: ${rect.right + 5}px;
            top: ${rect.top - 5}px;
            background: rgba(255, 235, 59, 0.9);
            color: #333;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 500;
            z-index: 10001;
            pointer-events: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            animation: fadeInOut 2s ease-in-out;
        `;
        hint.textContent = 'Release to capture';
        
        document.body.appendChild(hint);
        
        // Remove hint after animation
        setTimeout(() => {
            if (hint.parentNode) hint.remove();
        }, 2000);
    }

    // Enhanced keyword validation for text selection
    function isValidKeywordFromSelection(text) {
        if (!isValidKeyword(text)) return false;
        
        // Additional validation for selected text
        const trimmed = text.trim();
        
        // Skip if it's just punctuation or whitespace
        if (/^[\s\p{P}]+$/u.test(trimmed)) return false;
        
        // Skip if it's just numbers with units
        if (/^\d+\s*(k|m|b|%|\$)$/i.test(trimmed)) return false;
        
        // Skip common UI elements from Google Ads
        const skipPhrases = [
            'keyword ideas',
            'search volume',
            'competition',
            'suggested bid',
            'ad impr. share',
            'monthly searches',
            'low competition',
            'medium competition',
            'high competition'
        ];
        
        if (skipPhrases.some(phrase => 
            trimmed.toLowerCase().includes(phrase.toLowerCase())
        )) {
            return false;
        }
        
        return true;
    }

    // Comprehensive keyboard shortcuts system
    const keyboardShortcuts = {
        'ctrl+a': 'selectAllVisibleKeywords',
        'ctrl+shift+a': 'addAllSelectedKeywords',
        'ctrl+shift+n': 'addSelectedAsNegative',
        'ctrl+shift+c': 'copySelectedKeywords',
        'ctrl+shift+x': 'clearSelection',
        'ctrl+z': 'undoLastAction',
        'escape': 'clearSelection'
    };

    let actionHistory = [];
    const MAX_HISTORY = 10;

    // Keyboard event handler
    document.addEventListener('keydown', (event) => {
        const key = getKeyboardShortcut(event);
        const action = keyboardShortcuts[key];
        
        if (action && !isInputElement(event.target)) {
            event.preventDefault();
            executeKeyboardAction(action, event);
        }
    });

    function getKeyboardShortcut(event) {
        const parts = [];
        if (event.ctrlKey || event.metaKey) parts.push('ctrl');
        if (event.shiftKey) parts.push('shift');
        if (event.altKey) parts.push('alt');
        parts.push(event.key.toLowerCase());
        return parts.join('+');
    }

    function isInputElement(element) {
        const inputTypes = ['input', 'textarea', 'select', 'button'];
        return inputTypes.includes(element.tagName.toLowerCase()) || 
               element.contentEditable === 'true';
    }

    function executeKeyboardAction(action, event) {
        console.log('Executing keyboard action:', action);
        
        switch (action) {
            case 'selectAllVisibleKeywords':
                selectAllVisibleKeywords();
                break;
            case 'addAllSelectedKeywords':
                addAllSelectedKeywords();
                break;
            case 'addSelectedAsNegative':
                addSelectedAsNegative();
                break;
            case 'copySelectedKeywords':
                copySelectedKeywords();
                break;
            case 'clearSelection':
                clearSelection();
                break;
            case 'undoLastAction':
                undoLastAction();
                break;
        }
    }

    function selectAllVisibleKeywords() {
        const keywordElements = document.querySelectorAll('[data-test-id="keyword-text"], .keyword-text, [data-test-id="keyword-idea-text"]');
        let count = 0;
        
        keywordElements.forEach(element => {
            const keyword = element.textContent.trim();
            if (isValidKeyword(keyword) && isElementVisible(element)) {
                const keywordData = new KeywordData(keyword, element);
                keywordData.source = 'select_all';
                addKeywordToSelection(keywordData);
                count++;
            }
        });
        
        showQuickFeedback(`Selected ${count} visible keywords (Ctrl+Shift+A to add all)`, 'info');
        recordAction('selectAll', { count });
    }

    function addAllSelectedKeywords() {
        if (selectedKeywords.size === 0) {
            showQuickFeedback('No keywords selected', 'warning');
            return;
        }
        
        const keywords = Array.from(selectedKeywords.values());
        keywords.forEach(keywordData => {
            toggleKeyword(keywordData.cleanKeyword, true);
        });
        
        recordAction('addAll', { keywords: keywords.map(k => k.cleanKeyword) });
        showQuickFeedback(`Added ${keywords.length} keywords to MatchMate`, 'success');
        clearSelection();
    }

    function addSelectedAsNegative() {
        if (selectedKeywords.size === 0) {
            showQuickFeedback('No keywords selected', 'warning');
            return;
        }
        
        const keywords = Array.from(selectedKeywords.values());
        keywords.forEach(keywordData => {
            keywordData.isNegative = true;
            const negativeKeyword = `-${keywordData.cleanKeyword}`;
            toggleKeyword(negativeKeyword, true);
        });
        
        recordAction('addAsNegative', { keywords: keywords.map(k => k.cleanKeyword) });
        showQuickFeedback(`Added ${keywords.length} negative keywords to MatchMate`, 'warning');
        clearSelection();
    }

    function copySelectedKeywords() {
        if (selectedKeywords.size === 0) {
            showQuickFeedback('No keywords selected', 'warning');
            return;
        }
        
        const keywordText = Array.from(selectedKeywords.values())
            .map(k => k.isNegative ? `-${k.cleanKeyword}` : k.cleanKeyword)
            .join('\n');
        
        navigator.clipboard.writeText(keywordText).then(() => {
            showQuickFeedback(`Copied ${selectedKeywords.size} keywords to clipboard`, 'success');
        }).catch(() => {
            showQuickFeedback('Failed to copy to clipboard', 'error');
        });
        
        recordAction('copy', { count: selectedKeywords.size });
    }

    function clearSelection() {
        // Clear visual selection
        document.querySelectorAll('.matchmate-selected').forEach(element => {
            element.classList.remove('matchmate-selected');
            element.style.backgroundColor = '';
        });
        
        const count = selectedKeywords.size;
        selectedKeywords.clear();
        updateSelectionDisplay();
        
        if (count > 0) {
            showQuickFeedback(`Cleared selection of ${count} keywords`, 'info');
            recordAction('clear', { count });
        }
    }

    function undoLastAction() {
        if (actionHistory.length === 0) {
            showQuickFeedback('Nothing to undo', 'info');
            return;
        }
        
        const lastAction = actionHistory.pop();
        executeUndoAction(lastAction);
        showQuickFeedback(`Undid: ${lastAction.type}`, 'info');
    }

    function executeUndoAction(action) {
        switch (action.type) {
            case 'selectAll':
                clearSelection();
                break;
            case 'addAll':
            case 'addAsNegative':
                // Note: This would require communication with background script to remove keywords
                action.data.keywords.forEach(keyword => {
                    sendMessageWithRetry({ action: 'removeKeyword', keyword }).catch(() => {});
                });
                break;
            case 'clear':
                // Cannot easily undo a clear operation
                break;
        }
    }

    function recordAction(type, data) {
        actionHistory.push({
            type,
            data,
            timestamp: Date.now()
        });
        
        // Limit history size
        if (actionHistory.length > MAX_HISTORY) {
            actionHistory.shift();
        }
    }

    function isElementVisible(element) {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.left >= 0 && 
               rect.bottom <= window.innerHeight && 
               rect.right <= window.innerWidth;
    }

    // Enhanced checkbox handling for bulk selection
    let checkboxObserver;
    function setupCheckboxObserver() {
        if (checkboxObserver) return;
        
        checkboxObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'checked') {
                    const checkbox = mutation.target;
                    if (checkbox.tagName === 'INPUT' && checkbox.type === 'checkbox') {
                        const row = checkbox.closest('tr');
                        if (row) {
                            // Find the NEXT table row to get the keyword immediately following
                            const nextRow = row.nextElementSibling;
                            if (nextRow && nextRow.tagName === 'TR') {
                                const keywordElement = nextRow.querySelector('[data-test-id="keyword-text"], .keyword-text, [data-test-id="keyword-idea-text"]');
                                if (keywordElement) {
                                    const keyword = keywordElement.textContent?.trim();
                                    if (keyword && isValidKeyword(keyword)) {
                                        const keywordData = new KeywordData(keyword, keywordElement);
                                        keywordData.source = 'checkbox_observer';
                                        toggleKeyword(keywordData.cleanKeyword, checkbox.checked, keywordData);
                                    }
                                }
                            }
                        }
                    }
                }
            });
        });
        
        // Observe all checkboxes on the page
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkboxObserver.observe(checkbox, { attributes: true, attributeFilter: ['checked'] });
        });
    }

    // Auto-detect keywords from Google Keyword Planner when page loads or changes
    function autoDetectKeywordsFromKeywordPlanner() {
        const keywordRows = document.querySelectorAll('[data-test-id="keyword-idea-row"], .keyword-idea-row, tr[data-test-id*="keyword"]');
        
        if (keywordRows.length > 0) {
            console.log('Google Keyword Planner detected, scanning for keywords...');
            
            // Check for checked checkboxes and auto-add keywords from next row
            keywordRows.forEach((row, index) => {
                const checkbox = row.querySelector('input[type="checkbox"]');
                
                // Only process if this isn't the last row
                if (checkbox && index < keywordRows.length - 1) {
                    const nextRow = keywordRows[index + 1];
                    const keywordElement = nextRow.querySelector('[data-test-id="keyword-text"], .keyword-text, [data-test-id="keyword-idea-text"]');
                    
                    if (keywordElement) {
                        const keyword = keywordElement.textContent?.trim();
                        if (keyword && isValidKeyword(keyword) && checkbox.checked) {
                            const keywordData = new KeywordData(keyword, keywordElement);
                            keywordData.source = 'keyword_planner_auto';
                            toggleKeyword(keywordData.cleanKeyword, true, keywordData);
                        }
                    }
                }
            });
            
            // Setup observer for future checkbox changes
            setupCheckboxObserver();
        }
    }

    // Visual feedback for keyword capture
    function showSelectionFeedback(count) {
        const feedback = document.createElement('div');
        feedback.style.cssText = `
            position: fixed;
            top: 50px;
            right: 10px;
            background: #34a853;
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 500;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            animation: fadeInOut 2s ease-in-out;
        `;
        
        feedback.textContent = `✓ Captured ${count} keyword${count > 1 ? 's' : ''}`;
        
        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeInOut {
                0% { opacity: 0; transform: translateY(-10px); }
                20% { opacity: 1; transform: translateY(0); }
                80% { opacity: 1; transform: translateY(0); }
                100% { opacity: 0; transform: translateY(-10px); }
            }
        `;
        
        document.head.appendChild(style);
        document.body.appendChild(feedback);
        
        setTimeout(() => {
            feedback.remove();
            style.remove();
        }, 2000);
    }

    function detectKeywordsFromPage() {
        const keywords = new Set();
        
        // Enhanced selectors for Google Ads interface
        const selectors = [
            // Keyword Planner selectors
            '[data-test-id="keyword-text"]',
            '.keyword-text',
            '[data-test-id="keyword-idea-text"]',
            
            // Search Terms Report selectors
            '[data-test-id="search-term"]',
            '[data-column="search_term"] span',
            
            // General keyword table selectors
            '[role="gridcell"] span',
            'td[data-column="keyword"]',
            'td[data-column="search_term"]',
            '.kw-text',
            
            // Campaign and ad group keyword selectors
            '[data-test-id="keyword-text-cell"]',
            '.keyword-cell span',
            
            // Auction insights and other reports
            '[data-test-id="display-url"]',
            '.display-url-text'
        ];

        // Try each selector
        selectors.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    const text = el.textContent?.trim();
                    if (isValidKeyword(text)) {
                        keywords.add(text);
                    }
                });
            } catch (error) {
                console.debug('Selector failed:', selector, error);
            }
        });

        // Look for keywords in table cells more broadly
        const tableCells = document.querySelectorAll('td, th');
        tableCells.forEach(cell => {
            const text = cell.textContent?.trim();
            if (isValidKeyword(text) && text.length < 100) {
                keywords.add(text);
            }
        });

        // Look for text that appears to be keywords based on context
        const potentialKeywordElements = document.querySelectorAll('span, div');
        potentialKeywordElements.forEach(el => {
            const text = el.textContent?.trim();
            if (isValidKeyword(text) && 
                text.length > 2 && 
                text.length < 80 &&
                !hasChildElements(el)) {
                
                // Check if the element or its parent has keyword-related classes
                const elementClasses = (el.className + ' ' + (el.parentElement?.className || '')).toLowerCase();
                if (elementClasses.includes('keyword') || 
                    elementClasses.includes('search') ||
                    elementClasses.includes('term')) {
                    keywords.add(text);
                }
            }
        });

        return Array.from(keywords).slice(0, 2000); // Limit to 2000 keywords
    }

    function isValidKeyword(text) {
        if (!text || typeof text !== 'string') return false;
        
        const trimmed = text.trim();
        
        // Basic validation
        if (trimmed.length < 2 || trimmed.length > 200) return false;
        
        // Skip if it's a URL
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return false;
        }
        
        // Skip if it's mostly numbers or special characters
        if (/^\d+$/.test(trimmed)) return false;
        if (/^[^\w\s]+$/.test(trimmed)) return false;
        
        // Skip common UI text
        const skipPatterns = [
            /^(edit|delete|remove|add|save|cancel|ok|yes|no|close|open)$/i,
            /^(click|select|choose|view|show|hide|expand|collapse)$/i,
            /^(loading|error|success|warning|info|help|about)$/i,
            /^(home|back|next|previous|first|last|page|of|to|from)$/i,
            /^(search|filter|sort|group|by|all|none|any|other)$/i,
            /^\d+[\s\-]\d+$/, // Date ranges
            /^[\d,]+$/, // Numbers with commas
            /^[\d.]+%$/, // Percentages
            /^\$[\d,.]+$/, // Currency
            /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i, // Months
            /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i, // Days
            /^(am|pm)$/i, // Time
            /^(http|https|www|\.com|\.org|\.net)/i // URLs
        ];
        
        if (skipPatterns.some(pattern => pattern.test(trimmed))) return false;
        
        // Must contain at least one letter
        if (!/[a-zA-Z]/.test(trimmed)) return false;
        
        return true;
    }

    function hasChildElements(element) {
        return element.children && element.children.length > 0;
    }

    // Add visual indicator when extension is active (optional)
    function addVisualIndicator() {
        if (document.getElementById('matchmate-indicator')) return;
        
        const indicator = document.createElement('div');
        indicator.id = 'matchmate-indicator';
        indicator.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: #1a73e8;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        indicator.textContent = 'MatchMate Active';
        document.body.appendChild(indicator);
        
        // Remove after 3 seconds
        setTimeout(() => {
            const el = document.getElementById('matchmate-indicator');
            if (el) el.remove();
        }, 3000);
    }

    // Show indicator when script loads on Google Ads pages
    if (window.location.hostname.includes('ads.google.com') || 
        window.location.hostname.includes('adwords.google.com')) {
        addVisualIndicator();
        
        // Initialize enhanced capture features
        initializeEnhancedCapture();
        
        // Auto-detect keywords on page load
        setTimeout(() => {
            autoDetectKeywordsFromKeywordPlanner();
        }, 1000);
        
        // Monitor for dynamic content changes in Google Keyword Planner
        const observer = new MutationObserver((mutations) => {
            let shouldCheck = false;
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1 && (node.matches && (
                            node.matches('[data-test-id*="keyword"]') ||
                            node.matches('.keyword-idea-row') ||
                            node.querySelector('[data-test-id*="keyword"]')
                        ))) {
                            shouldCheck = true;
                        }
                    });
                }
            });
            
            if (shouldCheck) {
                setTimeout(() => {
                    autoDetectKeywordsFromKeywordPlanner();
                    enhanceRowSelection(); // Re-enhance new rows
                }, 500);
            }
        });
        
        // Start observing the document for changes
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Initialize enhanced capture features
    function initializeEnhancedCapture() {
        // Set up smart row selection
        enhanceRowSelection();
        
        // Initialize enhanced text selection capture
        enhanceTextSelectionCapture();
        
        // Add keyboard shortcuts help indicator
        addKeyboardShortcutsHelp();
        
        // Initialize selection tracking
        selectedKeywords = new Map();
        actionHistory = [];
        
        console.log('MatchMate enhanced capture features initialized with text selection highlighting');
    }

    function addKeyboardShortcutsHelp() {
        // Add a small help indicator for keyboard shortcuts
        const helpButton = document.createElement('div');
        helpButton.id = 'matchmate-help-button';
        helpButton.innerHTML = '?';
        helpButton.title = 'MatchMate Keyboard Shortcuts';
        helpButton.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 30px;
            height: 30px;
            background: #1a73e8;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            z-index: 9999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            transition: transform 0.2s;
        `;
        
        helpButton.addEventListener('mouseenter', () => {
            helpButton.style.transform = 'scale(1.1)';
        });
        
        helpButton.addEventListener('mouseleave', () => {
            helpButton.style.transform = 'scale(1)';
        });
        
        helpButton.addEventListener('click', showKeyboardShortcutsHelp);
        document.body.appendChild(helpButton);
    }

    function showKeyboardShortcutsHelp() {
        const helpModal = document.createElement('div');
        helpModal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 20px;
            z-index: 10002;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            max-width: 400px;
        `;
        
        helpModal.innerHTML = `
            <h3 style="margin: 0 0 15px 0; color: #1a73e8;">MatchMate Keyboard Shortcuts</h3>
            <div style="font-size: 13px; line-height: 1.5;">
                <p><strong>Ctrl+A:</strong> Select all visible keywords</p>
                <p><strong>Ctrl+Shift+A:</strong> Add all selected keywords</p>
                <p><strong>Ctrl+Shift+N:</strong> Add selected as negative keywords</p>
                <p><strong>Ctrl+Shift+C:</strong> Copy selected keywords</p>
                <p><strong>Ctrl+Shift+X:</strong> Clear selection</p>
                <p><strong>Ctrl+Z:</strong> Undo last action</p>
                <p><strong>Escape:</strong> Clear selection</p>
                <hr style="margin: 15px 0;">
                <p><strong>Click Methods:</strong></p>
                <p><strong>Ctrl+Click:</strong> Add to selection</p>
                <p><strong>Shift+Click:</strong> Add as negative keyword</p>
                <p><strong>Alt+Click:</strong> Add with related keywords</p>
                <p><strong>Double-click:</strong> Smart keyword capture</p>
            </div>
            <button id="close-help" style="
                margin-top: 15px;
                padding: 8px 16px;
                background: #1a73e8;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 13px;
            ">Close</button>
        `;
        
        // Add overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 10001;
        `;
        
        document.body.appendChild(overlay);
        document.body.appendChild(helpModal);
        
        // Close handlers
        const closeHelp = () => {
            overlay.remove();
            helpModal.remove();
        };
        
        helpModal.querySelector('#close-help').addEventListener('click', closeHelp);
        overlay.addEventListener('click', closeHelp);
        
        // Close on escape
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                closeHelp();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }

    // Helper function to highlight detected keywords (for debugging)
    function highlightKeywords() {
        const keywords = detectKeywordsFromPage();
        console.log('MatchMate detected keywords:', keywords);
        
        // Optional: visually highlight detected keywords
        keywords.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            const textNodes = [];
            let node;
            while (node = walker.nextNode()) {
                if (regex.test(node.textContent)) {
                    textNodes.push(node);
                }
            }
            
            textNodes.forEach(textNode => {
                const parent = textNode.parentNode;
                if (parent && !parent.classList.contains('matchmate-highlight')) {
                    parent.style.backgroundColor = '#fff3cd';
                    parent.classList.add('matchmate-highlight');
                }
            });
        });
    }

    // Enhanced keyword data structure for intelligent parsing
    class KeywordData {
        constructor(keyword, element = null) {
            this.originalText = keyword;
            this.cleanKeyword = this.removeExistingMatchType(keyword);
            this.detectedMatchType = this.detectExistingMatchType(keyword);
            this.isNegative = false;
            this.source = 'manual';
            this.timestamp = Date.now();
            this.element = element;
            this.contextData = this.extractContextualData(element);
        }

        removeExistingMatchType(keyword) {
            return keyword.replace(/^[\["]*|[\]"]*$/g, '').trim();
        }

        detectExistingMatchType(keyword) {
            if (keyword.startsWith('[') && keyword.endsWith(']')) return 'exact';
            if (keyword.startsWith('"') && keyword.endsWith('"')) return 'phrase';
            return 'broad';
        }

        extractContextualData(element) {
            if (!element) return {};
            
            const row = element.closest('tr');
            if (!row) return {};

            return {
                searchVolume: this.extractSearchVolume(row),
                competition: this.extractCompetition(row),
                cpc: this.extractCPC(row),
                relatedKeywords: this.extractRelatedKeywords(row)
            };
        }

        extractSearchVolume(row) {
            const volumeSelectors = [
                '[data-test-id*="search-volume"]',
                '[data-column*="volume"]',
                'td:nth-child(3)', // Common position for search volume
                '.search-volume'
            ];
            
            for (const selector of volumeSelectors) {
                const element = row.querySelector(selector);
                if (element && element.textContent.trim()) {
                    return element.textContent.trim();
                }
            }
            return null;
        }

        extractCompetition(row) {
            const competitionSelectors = [
                '[data-test-id*="competition"]',
                '[data-column*="competition"]',
                'td:nth-child(4)', // Common position for competition
                '.competition'
            ];
            
            for (const selector of competitionSelectors) {
                const element = row.querySelector(selector);
                if (element && element.textContent.trim()) {
                    return element.textContent.trim();
                }
            }
            return null;
        }

        extractCPC(row) {
            const cpcSelectors = [
                '[data-test-id*="cpc"]',
                '[data-column*="cpc"]',
                'td:nth-child(5)', // Common position for CPC
                '.cpc'
            ];
            
            for (const selector of cpcSelectors) {
                const element = row.querySelector(selector);
                if (element && element.textContent.trim() && element.textContent.includes('$')) {
                    return element.textContent.trim();
                }
            }
            return null;
        }

        extractRelatedKeywords(row) {
            const relatedKeywords = [];
            const allRows = row.parentElement.querySelectorAll('tr');
            const currentIndex = Array.from(allRows).indexOf(row);
            
            // Check adjacent rows for related keywords
            for (let i = Math.max(0, currentIndex - 2); i <= Math.min(allRows.length - 1, currentIndex + 2); i++) {
                if (i !== currentIndex) {
                    const adjacentRow = allRows[i];
                    const keywordElement = adjacentRow.querySelector('[data-test-id="keyword-text"], .keyword-text, [data-test-id="keyword-idea-text"]');
                    if (keywordElement && keywordElement.textContent.trim()) {
                        relatedKeywords.push(keywordElement.textContent.trim());
                    }
                }
            }
            return relatedKeywords;
        }
    }

    // Smart table row selection with full data extraction
    function enhanceRowSelection() {
        const tableSelectors = [
            'table[data-test-id*="keyword"]',
            '.keyword-ideas-table',
            '[role="grid"]',
            'table tbody tr'
        ];

        tableSelectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                if (!element.dataset.matchmateEnhanced) {
                    element.dataset.matchmateEnhanced = 'true';
                    addSmartRowSelection(element);
                }
            });
        });
    }

    function addSmartRowSelection(element) {
        // Add visual feedback for row hover
        element.addEventListener('mouseenter', function() {
            if (!this.classList.contains('matchmate-selected')) {
                this.style.backgroundColor = 'rgba(26, 115, 232, 0.1)';
                this.style.cursor = 'pointer';
            }
        });

        element.addEventListener('mouseleave', function() {
            if (!this.classList.contains('matchmate-selected')) {
                this.style.backgroundColor = '';
            }
        });

        // Smart row click handler
        element.addEventListener('click', function(event) {
            // Only handle if not already handled by other events
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON') {
                return;
            }

            const keywordElement = this.querySelector('[data-test-id="keyword-text"], .keyword-text, [data-test-id="keyword-idea-text"]');
            if (keywordElement) {
                const keyword = keywordElement.textContent.trim();
                if (isValidKeyword(keyword)) {
                    const keywordData = new KeywordData(keyword, keywordElement);
                    handleSmartKeywordCapture(keywordData, event);
                }
            }
        });
    }

    // Enhanced capture handler with multiple methods
    function handleSmartKeywordCapture(keywordData, event) {
        const captureMethod = determineCaptureMethod(event);
        keywordData.source = captureMethod;

        // Visual feedback
        const row = keywordData.element.closest('tr');
        if (row) {
            toggleRowSelection(row, keywordData);
        }

        // Process based on capture method
        switch (captureMethod) {
            case 'ctrl_click':
                handleCtrlClick(keywordData);
                break;
            case 'shift_click':
                handleShiftClick(keywordData);
                break;
            case 'alt_click':
                handleAltClick(keywordData);
                break;
            default:
                handleNormalClick(keywordData);
        }
    }

    function determineCaptureMethod(event) {
        if (event.ctrlKey || event.metaKey) return 'ctrl_click';
        if (event.shiftKey) return 'shift_click';
        if (event.altKey) return 'alt_click';
        return 'normal_click';
    }

    function handleCtrlClick(keywordData) {
        // Add to selection without clearing others
        addKeywordToSelection(keywordData);
        showQuickFeedback(`Added "${keywordData.cleanKeyword}" to selection`, 'success');
    }

    function handleShiftClick(keywordData) {
        // Add as negative keyword
        keywordData.isNegative = true;
        addKeywordToSelection(keywordData);
        showQuickFeedback(`Added "${keywordData.cleanKeyword}" as negative keyword`, 'warning');
    }

    function handleAltClick(keywordData) {
        // Add with related keywords
        addKeywordToSelection(keywordData);
        if (keywordData.contextData.relatedKeywords.length > 0) {
            keywordData.contextData.relatedKeywords.slice(0, 3).forEach(related => {
                const relatedData = new KeywordData(related);
                relatedData.source = 'related_suggestion';
                addKeywordToSelection(relatedData);
            });
            showQuickFeedback(`Added "${keywordData.cleanKeyword}" + ${keywordData.contextData.relatedKeywords.length} related keywords`, 'info');
        }
    }

    function handleNormalClick(keywordData) {
        // Standard single keyword addition
        toggleKeyword(keywordData.cleanKeyword, true);
    }

    // Selection management
    let selectedKeywords = new Map();

    function addKeywordToSelection(keywordData) {
        selectedKeywords.set(keywordData.cleanKeyword, keywordData);
        updateSelectionDisplay();
        
        // Send to background with enhanced data using improved retry mechanism
        sendMessageWithRetry({ 
            action: 'addKeyword', 
            keyword: keywordData.cleanKeyword,
            keywordData: keywordData,
            isNegative: keywordData.isNegative
        }).then(() => {
            console.log(`Successfully added keyword to selection: ${keywordData.cleanKeyword}`);
        }).catch(err => {
            console.log(`Extension communication failed for ${keywordData.cleanKeyword}:`, err.message);
            // Remove from local selection if failed to sync
            selectedKeywords.delete(keywordData.cleanKeyword);
            updateSelectionDisplay();
        });
    }

    function toggleRowSelection(row, keywordData) {
        const isSelected = row.classList.contains('matchmate-selected');
        
        if (isSelected) {
            row.classList.remove('matchmate-selected');
            row.style.backgroundColor = '';
            selectedKeywords.delete(keywordData.cleanKeyword);
        } else {
            row.classList.add('matchmate-selected');
            row.style.backgroundColor = keywordData.isNegative ? 
                'rgba(244, 67, 54, 0.1)' : 'rgba(76, 175, 80, 0.1)';
            selectedKeywords.set(keywordData.cleanKeyword, keywordData);
        }
        
        updateSelectionDisplay();
    }

    function updateSelectionDisplay() {
        // Update or create selection counter
        let counter = document.getElementById('matchmate-selection-counter');
        if (!counter && selectedKeywords.size > 0) {
            counter = document.createElement('div');
            counter.id = 'matchmate-selection-counter';
            counter.style.cssText = `
                position: fixed;
                top: 60px;
                right: 10px;
                background: #1a73e8;
                color: white;
                padding: 8px 12px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 500;
                z-index: 10000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                cursor: pointer;
            `;
            document.body.appendChild(counter);
            
            // Add click handler to show selection details
            counter.addEventListener('click', showSelectionDetails);
        }
        
        if (counter) {
            if (selectedKeywords.size === 0) {
                counter.remove();
            } else {
                const negativeCount = Array.from(selectedKeywords.values()).filter(k => k.isNegative).length;
                const positiveCount = selectedKeywords.size - negativeCount;
                counter.textContent = `${positiveCount} keywords${negativeCount > 0 ? ` + ${negativeCount} negative` : ''} selected`;
            }
        }
    }

    function showSelectionDetails() {
        const details = Array.from(selectedKeywords.values()).map(k => 
            `${k.isNegative ? '[-] ' : '[+] '}${k.cleanKeyword}${k.contextData.searchVolume ? ` (${k.contextData.searchVolume})` : ''}`
        ).join('\n');
        
        const popup = document.createElement('div');
        popup.style.cssText = `
            position: fixed;
            top: 100px;
            right: 10px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 12px;
            max-width: 300px;
            max-height: 200px;
            overflow-y: auto;
            z-index: 10001;
            font-family: monospace;
            font-size: 11px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            white-space: pre-line;
        `;
        popup.textContent = details;
        
        // Add close button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
            position: absolute;
            top: 4px;
            right: 4px;
            border: none;
            background: none;
            font-size: 16px;
            cursor: pointer;
        `;
        closeBtn.onclick = () => popup.remove();
        popup.appendChild(closeBtn);
        
        document.body.appendChild(popup);
        
        // Auto-remove after 5 seconds
        setTimeout(() => popup.remove(), 5000);
    }

    // Quick feedback system
    function showQuickFeedback(message, type = 'info') {
        const colors = {
            success: '#4caf50',
            warning: '#ff9800',
            error: '#f44336',
            info: '#2196f3'
        };
        
        const feedback = document.createElement('div');
        feedback.style.cssText = `
            position: fixed;
            top: 30px;
            right: 10px;
            background: ${colors[type]};
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            animation: slideIn 0.3s ease-out;
        `;
        
        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        
        feedback.textContent = message;
        document.body.appendChild(feedback);
        
        setTimeout(() => {
            feedback.remove();
            style.remove();
        }, 2000);
    }

    // Check if Chrome extension APIs are available
    function isChromeExtensionAvailable() {
        return typeof chrome !== 'undefined' && 
               chrome.runtime && 
               chrome.runtime.sendMessage;
    }

    // Enhanced message sending with health check
    async function sendMessageWithRetry(message, maxRetries = 3, delay = 100) {
        // First check if extension context is valid
        if (!isChromeExtensionAvailable()) {
            console.warn('Chrome extension APIs not available, skipping message send');
            return null;
        }
        
        if (!chrome.runtime || !chrome.runtime.sendMessage) {
            throw new Error('Extension context is invalid');
        }
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                // First ping the background script to ensure it's ready
                if (i === 0) {
                    await chrome.runtime.sendMessage({ action: 'ping' });
                }
                
                return await chrome.runtime.sendMessage(message);
            } catch (error) {
                console.log(`Communication attempt ${i + 1} failed:`, error.message);
                
                if (error.message.includes('Receiving end does not exist') || 
                    error.message.includes('Extension context invalidated') ||
                    error.message.includes('Could not establish connection')) {
                    
                    if (i === maxRetries - 1) {
                        // Show user-friendly error message
                        showQuickFeedback('Extension communication failed. Please refresh the page.', 'error');
                        throw new Error('Background script communication failed after retries');
                    }
                    
                    // Progressive delay for retries
                    await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
                    continue;
                } else {
                    throw error;
                }
            }
        }
    }

    // Initialize enhanced capture features
    function initializeEnhancedCapture() {
        // Add text selection listener
        addTextSelectionListener();
        
        // Initialize row enhancement
        enhanceRowSelection();
        
        // Set up mutation observer for dynamic content
        setupMutationObserver();
        
        console.log('MatchMate enhanced capture initialized');
    }
    
    function setupMutationObserver() {
        const observer = new MutationObserver((mutations) => {
            let shouldEnhance = false;
            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length > 0) {
                    shouldEnhance = true;
                }
            });
            
            if (shouldEnhance) {
                setTimeout(() => {
                    enhanceRowSelection();
                }, 500);
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Expose functions for debugging
    window.matchMateDebug = {
        detectKeywords: detectKeywordsFromPage,
        highlightKeywords: highlightKeywords,
        sendMessage: sendMessageWithRetry
    };
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeEnhancedCapture);
    } else {
        // DOM is already ready
        setTimeout(initializeEnhancedCapture, 100);
    }

})();
