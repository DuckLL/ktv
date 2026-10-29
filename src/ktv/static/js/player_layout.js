import { loadPracticeSettings, savePracticeSettings } from '/static/js/practice_settings.js';

// Move shared controls between desktop feature areas and mobile live controls/settings.
export function createPlayerLayout({ video, audio, pitchFeedback, media, onError }) {
  const $ = id => document.getElementById(id);
  const dialog = $('mobileSettings');
  const content = $('playerSettingsContent');
  const tabs = [...content.querySelectorAll('[role="tab"]')];
  const search = $('lyricsSearchPanel');
  const card = $('mobilePitchCard');
  const videoWrap = video.parentElement;
  const chartToggle = $('mobilePitchVisible');
  const chartControl = chartToggle.closest('label');
  const mixControl = document.querySelector('.audio-toggle');
  const mixHome = document.createComment('mix settings position');
  mixControl.before(mixHome);
  const settings = loadPracticeSettings();
  let selectedTab = ['sound', 'lyrics', 'pitch'].includes(settings.settingsTab) ? settings.settingsTab : 'sound';
  let showMv = true;

  $('mobileSoundPanel').append($('playbackSettings'));
  $('mobileLyricsPanel').append(search, $('offsetSettings'));
  $('mobilePitchPanel').insertBefore($('pitchPanel'), $('mobilePitchAdvanced'));
  $('pitchAdvancedContent').append(
    $('pitchSensitivity').closest('label'), $('pitchDelaySlider').closest('label'),
  );
  $('mobilePitchHead').append(document.querySelector('.pitch-legend'), $('pitchMicToggle'));
  card.insertBefore($('pitchCanvas'), $('mobilePitchMessage'));
  $('mobilePreviousRail').append($('previousLine'));
  $('mobileNextRail').append($('nextLine'));
  $('mobilePlaybackStatus').append($('audioStatus'), $('keyStatus'));
  $('mobileVideoActions').append($('mobileMvToggle'));
  document.querySelector('.player-header').insertBefore($('youtubeLink'), $('mobileSettingsOpen'));
  video.controls = true;
  for (const id of ['playbackSettings', 'offsetSettings', 'pitchPanel']) $(id).open = true;
  search.open = false;

  function selectTab(name, focus = false) {
    selectedTab = name;
    for (const tab of tabs) {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = $(tab.getAttribute('aria-controls'));
      panel.hidden = media.matches ? !selected : tab.dataset.tab !== 'lyrics';
      panel.setAttribute('role', media.matches ? 'tabpanel' : 'region');
      if (selected && focus) tab.focus();
    }
  }

  function openSettings(name = selectedTab, findLyrics = false) {
    selectTab(name);
    if (media.matches && !dialog.open) dialog.showModal();
    if (findLyrics) {
      search.open = true;
      $('lyricsSearchInput').focus();
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      selectTab(tab.dataset.tab);
      savePracticeSettings({ settingsTab: selectedTab });
    });
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectTab(tabs[next].dataset.tab, true);
      savePracticeSettings({ settingsTab: selectedTab });
    });
  });
  $('mobileSettingsOpen').addEventListener('click', () => openSettings());
  $('mobileSettingsClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (media.matches) {
      $('mobileSettingsOpen').focus();
    }
  });
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  $('mobileChangeLyrics').addEventListener('click', () => {
    search.open = !search.open;
    if (search.open) $('lyricsSearchInput').focus();
  });
  search.addEventListener('toggle', () => $('mobileChangeLyrics').setAttribute('aria-expanded', String(search.open)));
  const version = $('lyricsSelectionSummary');
  const syncVersion = () => { $('mobileVersionName').textContent = version.textContent; };
  new MutationObserver(syncVersion).observe(version, { childList: true, subtree: true, characterData: true });
  syncVersion();

  chartToggle.checked = settings.showPitchChart !== false;
  card.hidden = !chartToggle.checked;
  chartToggle.addEventListener('change', () => {
    card.hidden = !chartToggle.checked;
    if (card.hidden) pitchFeedback.stopMic();
    savePracticeSettings({ showPitchChart: chartToggle.checked });
  });
  const syncPitchState = () => {
    const status = $('pitchStatus');
    const message = status.textContent;
    $('mobilePitchLabel').textContent = pitchFeedback.stream
      ? (status.dataset.grade ? message : '收音中') : '原唱音高';
    $('mobilePitchLabel').title = message;
    card.classList.toggle('mic-active', Boolean(pitchFeedback.stream));
    document.querySelector('.player-main').classList.toggle('mic-active', Boolean(pitchFeedback.stream));
    $('mobilePitchMessage').textContent = !pitchFeedback.stream && /未取得|無法|尚無音高|HTTPS|失敗/.test(message) ? message : '';
  };
  new MutationObserver(syncPitchState).observe($('pitchStatus'), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-grade'] });
  syncPitchState();

  for (const [id, delta] of [['mobileKeyDown', -1], ['mobileKeyUp', 1]]) {
    $(id).addEventListener('click', () => {
      const select = $('keySelect');
      select.value = String(Math.max(-6, Math.min(6, Number(select.value) + delta)));
      select.dispatchEvent(new Event('change'));
    });
  }
  function applyVideoState() {
    // Keep native play/pause and seeking available when the MV is collapsed.
    videoWrap.classList.toggle('mv-collapsed', !showMv);
    $('mvStage').classList.toggle('has-mv', showMv);
    $('mobileMvToggle').setAttribute('aria-pressed', String(showMv));
    $('mobileMvToggle').setAttribute('aria-label', showMv ? '收起 MV' : '展開 MV');
    if (!videoWrap.hidden && audio.playing && video.paused) video.play().catch(onError);
  }
  $('mobileMvToggle').addEventListener('click', () => {
    showMv = !showMv;
    applyVideoState();
  });
  function updateVideoAspect() {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      videoWrap.style.setProperty('--video-aspect', `${video.videoWidth} / ${video.videoHeight}`);
    }
  }
  video.addEventListener('loadedmetadata', updateVideoAspect);
  video.addEventListener('resize', updateVideoAspect);
  updateVideoAspect();

  function updateMobilePitch() {
    if (!media.matches || card.hidden) {
      card.style.removeProperty('--mobile-pitch-extra');
      return;
    }
    const current = Number.parseFloat(card.style.getPropertyValue('--mobile-pitch-extra')) || 0;
    const available = $('lyricsWorkspace').clientHeight + current;
    // Reuse up to the former key row's height while preserving lyric space.
    const extra = Math.min(53, Math.max(0, available - 180));
    if (extra !== current) card.style.setProperty('--mobile-pitch-extra', `${extra}px`);
  }

  function adaptLayout() {
    if (!media.matches && dialog.open) dialog.close();
    (media.matches ? dialog : $('desktopSettings')).append(content);
    if (media.matches) {
      $('mobileSoundPanel').append($('playbackSettings'), $('mobileVideoActions'));
      $('mobileMixSettings').append(mixControl);
      $('mobileLyricSettings').append($('offsetSettings'));
      $('mobilePitchPanel').append($('pitchPanel'), $('mobilePitchAdvanced'));
      $('mobilePitchPanel').insertBefore(chartControl, $('pitchPanel'));
    } else {
      mixHome.after(mixControl);
      $('desktopSoundSettings').append($('playbackSettings'), $('mobileVideoActions'));
      $('desktopLyricSettings').append($('offsetSettings'));
      $('desktopPitchSettings').append(chartControl, $('pitchPanel'), $('mobilePitchAdvanced'));
      search.open = true;
    }
    $('mobileSettingsTitle').textContent = media.matches ? '練唱調整' : '歌詞版本';
    applyVideoState();
    updateVideoAspect();
    selectTab(selectedTab);
    updateMobilePitch();
  }
  let pitchResizeFrame = null;
  const resizeObserver = new ResizeObserver(() => {
    if (pitchResizeFrame !== null) return;
    pitchResizeFrame = requestAnimationFrame(() => {
      pitchResizeFrame = null;
      updateMobilePitch();
    });
  });
  for (const element of [document.querySelector('.player-main'), videoWrap, $('mvStage'), card]) resizeObserver.observe(element);
  media.addEventListener('change', adaptLayout);
  adaptLayout();
  return { openSettings };
}
