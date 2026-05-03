// js/save.js - セーブ・ロード (localStorage)
'use strict';

const SaveSystem = (() => {
  const PREFIX = 'chai_save_';
  const SLOTS = 3;

  function serialize(gameState) {
    return JSON.stringify({
      version: 2,
      timestamp: Date.now(),
      personality: gameState.personality,
      location: gameState.location,
      inventory: gameState.inventory,
      status: gameState.status,
      dreamChoices: gameState.dreamChoices,
      fieldChoices: gameState.fieldChoices,
      npcProgress: gameState.npcProgress,
      chaiGiven: gameState.chaiGiven,
      visitedLocations: gameState.visitedLocations,
      fieldEventsSeen: gameState.fieldEventsSeen,
      npcHistory: gameState.npcHistory,
      collectedItems: gameState.collectedItems,
      _vivekaNotified: gameState._vivekaNotified || 0,
    });
  }

  function save(slot, gameState) {
    if (slot < 0 || slot >= SLOTS) return false;
    try {
      localStorage.setItem(PREFIX + slot, serialize(gameState));
      return true;
    } catch (e) {
      console.error('Save failed:', e);
      return false;
    }
  }

  function load(slot) {
    if (slot < 0 || slot >= SLOTS) return null;
    try {
      const raw = localStorage.getItem(PREFIX + slot);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error('Load failed:', e);
      return null;
    }
  }

  function deleteSave(slot) {
    localStorage.removeItem(PREFIX + slot);
  }

  function listSlots() {
    const result = [];
    for (let i = 0; i < SLOTS; i++) {
      const raw = localStorage.getItem(PREFIX + i);
      if (!raw) {
        result.push({ slot: i, empty: true });
        continue;
      }
      try {
        const data = JSON.parse(raw);
        const loc = Story.locations[data.location]?.name || data.location;
        const date = new Date(data.timestamp);
        const dateStr = `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2,'0')}`;
        const personality = data.personality === 'A' ? 'やんちゃ' : data.personality === 'B' ? 'やさしい' : 'しずか';
        result.push({
          slot: i,
          empty: false,
          location: loc,
          personality,
          dateStr,
          data,
        });
      } catch {
        result.push({ slot: i, empty: true });
      }
    }
    return result;
  }

  function hasSaveData() {
    return listSlots().some(s => !s.empty);
  }

  function getNewestSave() {
    const slots = listSlots().filter(s => !s.empty);
    if (slots.length === 0) return null;
    slots.sort((a, b) => (b.data?.timestamp || 0) - (a.data?.timestamp || 0));
    return slots[0];
  }

  function autoSave(gameState) {
    try {
      localStorage.setItem('chai_autosave', serialize(gameState));
      return true;
    } catch(e) { return false; }
  }

  function getAutoSave() {
    try {
      const raw = localStorage.getItem('chai_autosave');
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  return { save, load, deleteSave, listSlots, hasSaveData, getNewestSave, autoSave, getAutoSave, SLOTS };
})();
