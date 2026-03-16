// ==UserScript==
// @name         AniPlay
// @namespace    http://tampermonkey.net/
// @version      1.43
// @description  Панель управления для Adobe Animate баннеров
// @match        *://*/*
// @include      file:///*
// @grant        none
// ==/UserScript==
// Version: 1.43

(function () {
    'use strict';

    // Версия скрипта для логирования
    const SCRIPT_VERSION = '1.43';

    // Ждём появления createjs.Ticker и сохраняем FPS при старте
    function waitForCreatejsTickerAndInitPanel(maxWaitMs = 10000, intervalMs = 100) {
        const start = Date.now();
        (function check() {
            if (
                typeof createjs !== 'undefined' &&
                createjs.Ticker &&
                typeof createjs.Ticker.framerate === 'number' &&
                createjs.Ticker.framerate !== 20
            ) {
                const ORIGINAL_FPS = createjs.Ticker.framerate;
                console.log(`[Animate Panel] ORIGINAL_FPS при старте: ${ORIGINAL_FPS}`);
                initAnimatePanel(ORIGINAL_FPS);
            } else if (Date.now() - start < maxWaitMs) {
                setTimeout(check, intervalMs);
            } else {
                console.warn('[Animate Panel] createjs.Ticker.framerate не найден или не изменился с 20, панель не будет инициализирована');
            }
        })();
    }

    // Функция для управления шириной баннера
    function initBannerWidthControl() {
        // Проверяем наличие контейнера баннера
        const animationContainer = document.getElementById('animation_container');
        if (!animationContainer) {
            console.warn('[Banner Control] animation_container не найден');
            return;
        }
        console.log('[Banner Control] animation_container найден', animationContainer);

        // Диапазон допустимой ширины баннера (используются при перетаскивании и вводе)
        // Уменьшили минимальную ширину, чтобы панель можно было сделать компактнее на небольших экранах
        let minBannerWidth = 150;
        let maxBannerWidth = 3000;

        function clampBannerWidth(value) {
            const n = parseInt(value, 10);
            if (isNaN(n) || n <= 0) return minBannerWidth;
            return Math.max(minBannerWidth, Math.min(maxBannerWidth, n));
        }

        // Окно страницы (в userscript с @grant контекст может отличаться — index.js читает свой window)
        const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        function setBannerWidthOverride(value) {
            window.bannerWidthOverride = value;
            pageWindow.bannerWidthOverride = value;
        }
        function getBannerWidthOverride() {
            return window.bannerWidthOverride != null ? window.bannerWidthOverride : pageWindow.bannerWidthOverride;
        }
        window.bannerWidthOverride = null;
        pageWindow.bannerWidthOverride = null;

        const docEl = document.documentElement;
        let originalClientWidthDescriptor = null;
        try {
            const proto = Object.getPrototypeOf(docEl);
            originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(proto, 'clientWidth');
        } catch (e) {
            console.warn('[Banner Control] Не удалось получить дескриптор clientWidth:', e);
        }
        let isClientWidthOverridden = false;

        function overrideClientWidth() {
            if (isClientWidthOverridden || !docEl) return;
            const origDesc = originalClientWidthDescriptor;
            const origGet = origDesc && typeof origDesc.get === 'function' ? origDesc.get : function() { return docEl.getBoundingClientRect().width; };
            Object.defineProperty(docEl, 'clientWidth', {
                get: function() {
                    const ov = getBannerWidthOverride();
                    if (ov != null) return clampBannerWidth(ov);
                    return origGet.call(this);
                },
                configurable: true,
                enumerable: origDesc ? origDesc.enumerable !== false : true
            });
            isClientWidthOverridden = true;
        }

        function restoreClientWidth() {
            if (!isClientWidthOverridden || !docEl) return;
            try {
                delete docEl.clientWidth;
            } catch (e) {}
            if (originalClientWidthDescriptor) {
                try {
                    Object.defineProperty(docEl, 'clientWidth', originalClientWidthDescriptor);
                } catch (e) {
                    console.warn('[Banner Control] Не удалось восстановить clientWidth:', e);
                }
            }
            isClientWidthOverridden = false;
        }

        // Функция для сохранения настроек ширины
        function saveBannerWidthSettings(width, isActive) {
            try {
                localStorage.setItem('animateBannerWidth', width ? width.toString() : '');
                localStorage.setItem('animateBannerWidthActive', isActive ? 'true' : 'false');
                console.log(`[Banner Control] Сохранены настройки: ширина=${width}, активно=${isActive}`);
            } catch(e) {
                console.warn('[Banner Control] Ошибка при сохранении настроек ширины:', e);
            }
        }

        // Восстанавливаем сохраненные настройки
        let savedWidth = null;
        try {
            const savedWidthValue = localStorage.getItem('animateBannerWidth');
            if (savedWidthValue && !isNaN(savedWidthValue)) {
                savedWidth = parseInt(savedWidthValue);
                console.log(`[Banner Control] Восстановлена ширина: ${savedWidth}px`);
            }
        } catch(e) {
            console.warn('[Banner Control] Ошибка при чтении сохраненной ширины:', e);
        }

        // Восстанавливаем состояние активности
        let isWidthControlActive = false;
        try {
            isWidthControlActive = localStorage.getItem('animateBannerWidthActive') === 'true';
            console.log(`[Banner Control] Восстановлено состояние активности: ${isWidthControlActive}`);
        } catch(e) {
            console.warn('[Banner Control] Ошибка при чтении состояния активности:', e);
        }

        // Для блокировки переходов по ссылкам в баннере
        window.isBannerEditModeActive = false;

        // Функция для блокировки кликов по баннеру
        function blockBannerClicks() {
            if (!window.clickBlockerInstalled) {
                // Создаем функцию-обработчик
                window.bannerClickHandler = function(e) {
                    if (window.isBannerEditModeActive) {
                        // Блокируем переход по ссылкам внутри баннера
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('[Banner Control] Клик по баннеру заблокирован');
                    }
                };

                // Находим все ссылки внутри баннера
                const bannerElement = document.getElementById('banner') ||
                                     document.querySelector('.banner') ||
                                     document.getElementById('animation_container');

                if (bannerElement) {
                    // Добавляем обработчик на уровень баннера для перехвата всех кликов
                    bannerElement.addEventListener('click', window.bannerClickHandler, true);

                    // Для надежности - обработчик на уровне document
                    document.addEventListener('click', function(e) {
                        if (window.isBannerEditModeActive) {
                            // Проверяем, находится ли клик внутри баннера
                            let target = e.target;
                            while (target) {
                                if (target === bannerElement) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    console.log('[Banner Control] Клик по баннеру заблокирован (глубокий перехват)');
                                    return;
                                }
                                target = target.parentElement;
                            }
                        }
                    }, true);

                    window.clickBlockerInstalled = true;
                    console.log('[Banner Control] Система блокировки кликов установлена');
                } else {
                    console.warn('[Banner Control] Не найден элемент баннера для блокировки кликов');
                }
            }
        }

        // Устанавливаем блокировщик кликов при инициализации
        blockBannerClicks();

        // Создаём ползунок для изменения ширины (в body с position:fixed, чтобы не обрезало overflow)
        const resizeHandle = document.createElement('div');
        Object.assign(resizeHandle.style, {
            position: 'fixed',
            width: '10px',
            cursor: 'ew-resize',
            background: 'rgba(0, 120, 255, 0.1)',
            zIndex: '9998',
            boxShadow: '0 0 2px rgba(0, 120, 255, 0.8)',
            transition: 'background 0.2s, opacity 0.3s',
            opacity: '0',
            left: '0', top: '0', height: '0'
        });

        const dragHandle = document.createElement('div');
        Object.assign(dragHandle.style, {
            position: 'fixed',
            width: 'auto',
            minWidth: '20px',
            height: '36px',
            background: 'rgba(80, 80, 80, 0.7)',
            borderRadius: '4px 0 0 4px',
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)',
            zIndex: '9999',
            cursor: 'ew-resize',
            transition: 'background 0.2s, opacity 0.3s',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '0 8px',
            opacity: '0',
            gap: '4px',
            left: '0', top: '0'
        });

        let _lastLoggedRight = null;
        function updateHandlePosition() {
            if (!animationContainer) {
                console.log('[Banner Control] updateHandlePosition: animationContainer нет');
                return;
            }
            if (!document.body.contains(resizeHandle)) {
                console.log('[Banner Control] updateHandlePosition: resizeHandle не в body');
                return;
            }
            const rect = animationContainer.getBoundingClientRect();
            const resizeLeft = rect.right;
            const dragLeft = rect.right - 80;
            const dragTop = rect.bottom + 4;
            resizeHandle.style.left = resizeLeft + 'px';
            resizeHandle.style.top = rect.top + 'px';
            resizeHandle.style.height = rect.height + 'px';
            dragHandle.style.left = dragLeft + 'px';
            dragHandle.style.top = dragTop + 'px';
            dragHandle.style.width = '80px';
            if (_lastLoggedRight !== rect.right) {
                _lastLoggedRight = rect.right;
                console.log('[Banner Control] updateHandlePosition: rect.right=', rect.right, 'rect.width=', rect.width, 'offsetWidth=', animationContainer.offsetWidth, 'resizeHandle.left=', resizeLeft);
            }
        }

        // Только установка ширины в DOM (без событий), чтобы не давать странице сбрасывать ширину
        function applyWidthToDomOnly(w) {
            if (!animationContainer || w == null) return;
            const width = Math.max(minBannerWidth, Math.min(maxBannerWidth, w));
            const before = animationContainer.offsetWidth;
            animationContainer.style.width = width + 'px';
            const canvas = document.getElementById('canvas');
            const domOverlay = document.getElementById('dom_overlay_container');
            if (canvas) {
                canvas.width = width * (window.devicePixelRatio || 1);
                canvas.style.width = width + 'px';
            }
            if (domOverlay) domOverlay.style.width = width + 'px';
            const after = animationContainer.offsetWidth;
            console.log('[Banner Control] applyWidthToDomOnly: w=', w, 'width=', width, 'до=', before, 'после=', after, 'canvas=', !!canvas, 'domOverlay=', !!domOverlay);
        }

        function clearWidthFromDom() {
            if (!animationContainer) return;
            console.log('[Banner Control] clearWidthFromDom: сбрасываем inline width, offsetWidth до=', animationContainer.offsetWidth);
            animationContainer.style.width = '';
            const canvas = document.getElementById('canvas');
            const domOverlay = document.getElementById('dom_overlay_container');
            if (canvas) canvas.style.width = '';
            if (domOverlay) domOverlay.style.width = '';
        }

        // При override эмулируем clientWidth и вызываем _onResize(); страница сама выставит ширину по «viewport».
        function applyBannerWidthAndUpdateUI() {
            const override = getBannerWidthOverride();
            const hasOnResize = typeof pageWindow.BannerResponsive !== 'undefined' && typeof pageWindow.BannerResponsive._onResize === 'function';
            if (override != null && animationContainer) {
                overrideClientWidth();
                if (hasOnResize) pageWindow.BannerResponsive._onResize();
                applyWidthToDomOnly(override);
                requestAnimationFrame(() => {
                    if (hasOnResize) pageWindow.BannerResponsive._onResize();
                    applyWidthToDomOnly(override);
                    requestAnimationFrame(() => {
                        applyWidthToDomOnly(override);
                        updateHandlePosition();
                    });
                });
            } else {
                if (override == null) {
                    restoreClientWidth();
                    clearWidthFromDom();
                    window.dispatchEvent(new Event('resize'));
                    if (hasOnResize) pageWindow.BannerResponsive._onResize();
                }
                requestAnimationFrame(updateHandlePosition);
            }
        }

        // Создаём элемент для отображения ширины
        const widthInfo = document.createElement('div');
        Object.assign(widthInfo.style, {
            color: '#fff',
            fontSize: '12px',
            fontFamily: 'Arial, sans-serif',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            userSelect: 'none'
        });

        // Функция обновления информации о ширине
        function updateWidthInfo() {
            const currentWidth = animationContainer.offsetWidth;
            widthInfo.textContent = `${currentWidth}px`;
        }

        // При изменении размера контейнера: если включён режим и кто-то сбросил ширину (frame_0 и т.д.) — возвращаем нашу
        let _roCallCount = 0;
        const resizeObserver = new ResizeObserver(() => {
            _roCallCount++;
            updateWidthInfo();
            const override = getBannerWidthOverride();
            const current = animationContainer ? animationContainer.offsetWidth : 0;
            if (isWidthControlActive && override != null && animationContainer) {
                const want = Math.max(minBannerWidth, Math.min(maxBannerWidth, override));
                const diff = Math.abs(current - want);
                const needReapply = diff > 2;
                if (_roCallCount <= 5 || needReapply || _roCallCount % 15 === 0) {
                    console.log('[Banner Control] ResizeObserver: вызов', _roCallCount, 'current=', current, 'want=', want, 'override=', override, 'diff=', diff, 'reapply=', needReapply);
                }
                if (needReapply) {
                    console.log('[Banner Control] ResizeObserver: сброс ширины обнаружен, возвращаем', want);
                    overrideClientWidth();
                    if (typeof pageWindow.BannerResponsive !== 'undefined' && typeof pageWindow.BannerResponsive._onResize === 'function') {
                        pageWindow.BannerResponsive._onResize();
                    }
                    applyWidthToDomOnly(override);
                }
            }
            if (isWidthControlActive) updateHandlePosition();
        });
        resizeObserver.observe(animationContainer);

        let _windowResizeCount = 0;
        const resizeListener = () => {
            _windowResizeCount++;
            if (_windowResizeCount <= 3 || _windowResizeCount % 10 === 0) {
                console.log('[Banner Control] window resize: событие', _windowResizeCount, 'bannerWidthOverride=', getBannerWidthOverride(), 'container.offsetWidth=', animationContainer ? animationContainer.offsetWidth : null);
            }
            if (isWidthControlActive) updateHandlePosition();
        };
        window.addEventListener('resize', resizeListener);

        // Добавляем внутренние полоски для визуального оформления маркера
        const handleLines = document.createElement('div');
        Object.assign(handleLines.style, {
            width: '8px',
            height: '18px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flexShrink: 0
        });

        // Создаем три полоски внутри маркера
        for (let i = 0; i < 3; i++) {
            const line = document.createElement('div');
            Object.assign(line.style, {
                height: '2px',
                background: 'rgba(255, 255, 255, 0.9)',
                borderRadius: '1px'
            });
            handleLines.appendChild(line);
        }

        // Добавляем элементы в маркер
        dragHandle.appendChild(widthInfo);
        dragHandle.appendChild(handleLines);

        // Инициализируем информацию о ширине
        updateWidthInfo();

        // Добавляем эффект при наведении
        dragHandle.addEventListener('mouseenter', () => {
            if (isWidthControlActive) {
                dragHandle.style.background = 'rgba(80, 80, 80, 0.9)';
            }
        });

        dragHandle.addEventListener('mouseleave', () => {
            if (isWidthControlActive) {
                dragHandle.style.background = 'rgba(80, 80, 80, 0.7)';
            }
        });

        // Добавляем эффект при наведении
        resizeHandle.addEventListener('mouseenter', () => {
            if (isWidthControlActive) {
                resizeHandle.style.background = 'rgba(0, 120, 255, 0.3)';
                dragHandle.style.background = 'rgba(80, 80, 80, 0.9)';
            }
        });

        resizeHandle.addEventListener('mouseleave', () => {
            if (isWidthControlActive) {
                resizeHandle.style.background = 'rgba(0, 120, 255, 0.1)';
                if (!dragHandle.matches(':hover')) {
                    dragHandle.style.background = 'rgba(80, 80, 80, 0.7)';
                }
            }
        });

        // Добавляем обработчик двойного клика для ручного ввода ширины
        function handleManualWidthInput() {
            if (!isWidthControlActive) return;

            // Получаем текущую ширину баннера
            const currentWidth = animationContainer.offsetWidth;

            // Показываем диалоговое окно для ввода новой ширины
            const newWidth = prompt(`Введите новую ширину баннера (текущая: ${currentWidth}px):`, currentWidth);

            // Проверяем введенное значение
            if (newWidth !== null && !isNaN(newWidth) && parseInt(newWidth) > 0) {
                const width = clampBannerWidth(newWidth);
                setBannerWidthOverride(width);
                applyBannerWidthAndUpdateUI();
                saveBannerWidthSettings(width, isWidthControlActive);
            }
        }

        // Добавляем обработчики двойного клика для обоих элементов
        resizeHandle.addEventListener('dblclick', handleManualWidthInput);
        dragHandle.addEventListener('dblclick', handleManualWidthInput);

        // Логика перетаскивания (добавляем обработчик и для маркера)
        let isDragging = false;
        let startX, startWidth;

        function startDrag(e) {
            if (!isWidthControlActive) return;
            isDragging = true;
            startX = e.clientX;
            startWidth = getBannerWidthOverride() != null ? getBannerWidthOverride() : animationContainer.offsetWidth;
            console.log('[Banner Control] startDrag: startX=', startX, 'startWidth=', startWidth, 'bannerWidthOverride=', getBannerWidthOverride(), 'container.offsetWidth=', animationContainer.offsetWidth);
            document.body.style.cursor = 'ew-resize';
            e.preventDefault();
        }

        resizeHandle.addEventListener('mousedown', startDrag);
        dragHandle.addEventListener('mousedown', startDrag);

        let _dragLogCount = 0;
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const newWidth = startWidth + (e.clientX - startX);
            const width = clampBannerWidth(newWidth);
            setBannerWidthOverride(width);
            _dragLogCount++;
            if (_dragLogCount % 10 === 1) console.log('[Banner Control] mousemove drag: clientX=', e.clientX, 'delta=', e.clientX - startX, 'width=', width, 'container.offsetWidth=', animationContainer.offsetWidth);
            applyBannerWidthAndUpdateUI();
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                console.log('[Banner Control] mouseup: итоговая ширина=', getBannerWidthOverride(), 'container.offsetWidth=', animationContainer.offsetWidth);
                saveBannerWidthSettings(getBannerWidthOverride(), isWidthControlActive);
                isDragging = false;
                document.body.style.cursor = '';
            }
        });

        // Функция для создания кнопки управления шириной
        function createWidthControlButton(scaleBox) {
            console.log('[Banner Control] createWidthControlButton вызвана, scaleBox=', scaleBox, 'scaleBox в DOM=', scaleBox ? document.contains(scaleBox) : 'нет');
            // Создаём контейнер для кнопки
            const widthControlContainer = document.createElement('div');
            Object.assign(widthControlContainer.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                margin: '8px 0 0 0',
                alignSelf: 'center'
            });

            const widthControlBtn = document.createElement('button');
            widthControlBtn.title = 'Включить/выключить изменение ширины баннера';
            widthControlBtn.innerHTML = '<span class="material-icons" style="font-size:28px;">swap_horiz</span>';
            Object.assign(widthControlBtn.style, {
                width: '44px',
                height: '44px',
                borderRadius: '8px',
                border: 'none',
                background: 'rgba(0,0,0,0.5)',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0',
                boxShadow: '0 2px 8px rgba(0,0,0,0.13)',
                transition: 'background 0.18s, box-shadow 0.18s'
            });

            widthControlBtn.addEventListener('mouseenter', () => {
                widthControlBtn.style.background = 'rgba(255,255,255,0.2)';
            });

            widthControlBtn.addEventListener('mouseleave', () => {
                widthControlBtn.style.background = isWidthControlActive ? 'rgba(0,180,0,0.5)' : 'rgba(0,0,0,0.5)';
            });

            widthControlBtn.addEventListener('mousedown', () => {
                widthControlBtn.style.background = 'rgba(255,255,255,0.32)';
            });

            widthControlBtn.addEventListener('mouseup', () => {
                widthControlBtn.style.background = 'rgba(255,255,255,0.2)';
            });

            // Обработчик клика для включения/выключения режима изменения ширины
            widthControlBtn.addEventListener('click', () => {
                isWidthControlActive = !isWidthControlActive;
                console.log('[Banner Control] Клик по кнопке: isWidthControlActive=', isWidthControlActive, 'resizeHandle.parentNode=', resizeHandle.parentNode ? 'есть' : 'нет', 'dragHandle.parentNode=', dragHandle.parentNode ? 'есть' : 'нет');

                // Обновляем глобальное состояние режима изменения ширины
                window.isWidthControlActive = isWidthControlActive;

                // Обновляем глобальное состояние режима редактирования баннера
                window.isBannerEditModeActive = isWidthControlActive ||
                    (window.isRulersActive === true);

                if (isWidthControlActive) {
                    overrideClientWidth();
                    if (savedWidth !== null) {
                        const widthToApply = clampBannerWidth(savedWidth);
                        setBannerWidthOverride(widthToApply);
                        applyBannerWidthAndUpdateUI();
                        console.log(`[Banner Control] Применена сохраненная ширина: ${widthToApply}px`);
                    } else {
                        updateHandlePosition();
                    }
                } else {
                    restoreClientWidth();
                    setBannerWidthOverride(null);
                    applyBannerWidthAndUpdateUI();
                }

                // Сохраняем состояние
                saveBannerWidthSettings(
                    isWidthControlActive ? getBannerWidthOverride() : null,
                    isWidthControlActive
                );

                // Меняем цвет кнопки в зависимости от состояния
                widthControlBtn.style.background = isWidthControlActive ? 'rgba(0,180,0,0.5)' : 'rgba(0,0,0,0.5)';

                // Показываем/скрываем элементы контроля ширины
                resizeHandle.style.opacity = isWidthControlActive ? '1' : '0';
                dragHandle.style.opacity = isWidthControlActive ? '1' : '0';
                resizeHandle.style.pointerEvents = isWidthControlActive ? 'auto' : 'none';
                dragHandle.style.pointerEvents = isWidthControlActive ? 'auto' : 'none';
                if (isWidthControlActive) updateHandlePosition();
                console.log('[Banner Control] Ползунок: opacity=', resizeHandle.style.opacity, 'pointerEvents=', resizeHandle.style.pointerEvents);
            });

            // Добавляем кнопку в контейнер
            widthControlContainer.appendChild(widthControlBtn);

            // Добавляем контейнер в scaleBox
            scaleBox.appendChild(widthControlContainer);

            return widthControlBtn;
        }

        // Добавляем ползунок и маркер в body (position:fixed), чтобы не обрезало overflow у родителей
        document.body.appendChild(resizeHandle);
        document.body.appendChild(dragHandle);
        console.log('[Banner Control] Ползунок и маркер добавлены в document.body (position:fixed)');

        // Если режим изменения ширины был активен до перезагрузки,
        // активируем его автоматически
        if (isWidthControlActive) {
            console.log('[Banner Control] Авто-восстановление: режим был активен, показываем ползунок');
            resizeHandle.style.opacity = '1';
            dragHandle.style.opacity = '1';
            resizeHandle.style.pointerEvents = 'auto';
            dragHandle.style.pointerEvents = 'auto';
            updateHandlePosition();
            window.isWidthControlActive = true;
            window.isBannerEditModeActive = true || (window.isRulersActive === true);
            if (savedWidth !== null) {
                const widthToApply = clampBannerWidth(savedWidth);
                setBannerWidthOverride(widthToApply);
                overrideClientWidth();
                applyBannerWidthAndUpdateUI();
                console.log(`[Banner Control] Автоматически активирован режим изменения ширины с шириной: ${widthToApply}px`);
            }
        }

        // Сохраняем функции для последующего использования (в т.ч. при клике по комментарию в списке замечаний)
        window.createWidthControlButton = createWidthControlButton;
        window.setBannerWidthOverride = setBannerWidthOverride;
        window.applyBannerWidthAndUpdateUI = applyBannerWidthAndUpdateUI;

        console.log('[Banner Control] Управление шириной баннера инициализировано. createWidthControlButton назначена на window. Ползунок виден только после нажатия кнопки с иконкой swap_horiz на панели.');
    }

    function initAnimatePanel(ORIGINAL_FPS) {
        // Проверка Animate-страницы с повторными попытками
        let checkAttempts = 0;
        const maxAttempts = 4;
        const checkDelay = 500; // 500ms между попытками

        function checkAnimationContainer() {
            checkAttempts++;
            const animationContainer = document.getElementById('animation_container');

            console.log(`[Animate Panel] Попытка ${checkAttempts}/${maxAttempts}: поиск animation_container...`);

            if (animationContainer) {
        console.log('[Animate Panel] Adobe Animate страница обнаружена');
        if (typeof ORIGINAL_FPS === 'undefined') {
            console.warn('[Animate Panel] ORIGINAL_FPS не найден: сброс FPS работать не будет');
        } else {
            console.log(`[Animate Panel] ORIGINAL_FPS: ${ORIGINAL_FPS}`);
        }

                // Контейнер найден, продолжаем инициализацию
                initializePanelComponents();
                return;
            }

            if (checkAttempts < maxAttempts) {
                console.log(`[Animate Panel] animation_container не найден, повтор через ${checkDelay}ms...`);
                setTimeout(checkAnimationContainer, checkDelay);
            } else {
                console.warn(`[Animate Panel] animation_container не найден после ${maxAttempts} попыток, прекращение инициализации`);
                return;
            }
        }

        function initializePanelComponents() {
        // Подключаем Material Icons
        const link = document.createElement('link');
        link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
        link.rel = 'stylesheet';
        document.head.appendChild(link);

        // Инициализируем управление шириной баннера
        initBannerWidthControl();

        // Настройки фона
        const bgExpanded = 'rgba(0, 0, 0, 0.7)';
        const bgCollapsed = 'transparent';

        // Создаём панель
        const panel = document.createElement('div');
        panel.className = 'aniplay-panel'; // Уникальный класс для идентификации
        Object.assign(panel.style, {
            position: 'fixed',
            top: '16px',
            left: '16px',
            background: bgExpanded,
            borderRadius: '10px',
            padding: '7px',
            zIndex: '9999',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            transition: 'width 0.2s, height 0.2s, background 0.2s, opacity 0.2s',
            overflow: 'hidden',
            minWidth: '52px',
            maxWidth: '100px',
            fontFamily: 'Arial, sans-serif',
            boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
            opacity: '1',
            pointerEvents: 'auto',
            width: 'auto',
            height: 'auto',
            paddingTop: '36px',
        });

        // Контейнер кнопок + счетчика
        const btnContainer = document.createElement('div');
        Object.assign(btnContainer.style, {
            display: 'flex',
            flexDirection: 'column',
            gap: '7px',
            marginTop: '6px',
            alignItems: 'center',
            width: '100%',
            minWidth: '0'
        });

        // === Области с комментариями (оверлей над баннером) ===
        const bannerEl = document.getElementById('animation_container');
        let commentAreasByFrame = {};
        let commentAreasOverlay = null;
        let commentAreasContainer = null;
        let addAreaOverlay = null;
        let addAreaModeActive = false;
        let addAreaDrawing = false;
        let addAreaStartX = 0, addAreaStartY = 0;
        let addAreaTempRect = null;
        let expandedCommentFrame = null;
        let expandedCommentAreaIndex = null;
        let isCommentTextEditing = false;
        function getCurrentFrame1Based() {
            if (typeof window.exportRoot === 'undefined') return 1;
            const cf = typeof window.exportRoot.currentFrame === 'number'
                ? window.exportRoot.currentFrame
                : (window.exportRoot.timeline && typeof window.exportRoot.timeline.position === 'number'
                    ? window.exportRoot.timeline.position
                    : 0);
            return cf + 1;
        }
        function positionCommentOverlay() {
            if (!bannerEl || !commentAreasOverlay) return;
            const r = bannerEl.getBoundingClientRect();
            Object.assign(commentAreasOverlay.style, {
                left: r.left + 'px',
                top: r.top + 'px',
                width: r.width + 'px',
                height: r.height + 'px'
            });
            if (addAreaOverlay) {
                Object.assign(addAreaOverlay.style, {
                    left: r.left + 'px',
                    top: r.top + 'px',
                    width: r.width + 'px',
                    height: r.height + 'px'
                });
            }
        }
        function getErrorsListItems() {
            const items = [];
            const frames = Object.keys(commentAreasByFrame).map(Number).filter(function (f) { return f >= 1; }).sort(function (a, b) { return a - b; });
            const MAX_PREVIEW_LEN = 50;
            frames.forEach(function (frame) {
                const areas = commentAreasByFrame[frame] || [];
                areas.forEach(function (area, areaIndex) {
                    const text = (area.t && String(area.t).trim()) ? String(area.t).trim().slice(0, MAX_PREVIEW_LEN) : '';
                    items.push({ frame: frame, areaIndex: areaIndex, text: text, bannerWidth: area.bannerWidth });
                });
            });
            return items;
        }
        function renderCommentAreas() {
            if (!commentAreasContainer) return;
            if (isCommentTextEditing) return;
            commentAreasContainer.innerHTML = '';
            const frame = getCurrentFrame1Based();
            if (frame !== expandedCommentFrame) {
                expandedCommentFrame = null;
                expandedCommentAreaIndex = null;
            }
            const areas = commentAreasByFrame[frame] || [];
            const MAX_COMMENT_LEN = 200;
            const PREVIEW_LEN = 35;
            areas.forEach(function (area, areaIndex) {
                const x = Math.max(0, Math.min(100, Number(area.x) || 0));
                const y = Math.max(0, Math.min(100, Number(area.y) || 0));
                const w = Math.max(0.5, Math.min(100 - x, Number(area.w) || 10));
                const h = Math.max(0.5, Math.min(100 - y, Number(area.h) || 10));
                const t = (area.t && String(area.t).slice(0, MAX_COMMENT_LEN)) || '';
                const preview = t ? (t.length > PREVIEW_LEN ? t.slice(0, PREVIEW_LEN) + '…' : t) : '';
                const isExpanded = expandedCommentFrame === frame && expandedCommentAreaIndex === areaIndex;
                const box = document.createElement('div');
                box.setAttribute('data-area-index', String(areaIndex));
                if (isExpanded) {
                    Object.assign(box.style, {
                        position: 'absolute',
                        left: x + '%',
                        top: y + '%',
                        width: w + '%',
                        height: h + '%',
                        background: 'rgba(251, 191, 36, 0.15)',
                        border: '1px solid rgba(251, 191, 36, 0.6)',
                        borderRadius: '6px',
                        pointerEvents: 'auto',
                        cursor: 'default',
                        boxSizing: 'border-box'
                    });
                    commentAreasContainer.appendChild(box);
                    const belowPanel = document.createElement('div');
                    belowPanel.setAttribute('data-area-index', String(areaIndex));
                    Object.assign(belowPanel.style, {
                        position: 'absolute',
                        left: x + '%',
                        top: (y + h) + '%',
                        marginTop: '6px',
                        width: w + '%',
                        minWidth: '120px',
                        pointerEvents: 'auto',
                        boxSizing: 'border-box'
                    });
                    const textPanel = document.createElement('div');
                    textPanel.style.cssText = 'padding:8px 10px;background:rgba(255,255,255,0.95);border:1px solid rgba(251,191,36,0.4);border-radius:6px;font-family:Arial,sans-serif;font-size:15px;color:#1a1a1a;white-space:pre-wrap;word-break:break-word;line-height:1.4;overflow-y:visible';
                    textPanel.textContent = t || '(нет текста)';
                    textPanel.title = 'Двойной клик — редактировать';
                    belowPanel.appendChild(textPanel);
                    function exitCommentEditMode(save) {
                        if (textPanel.getAttribute('data-comment-editing') !== '1') return;
                        isCommentTextEditing = false;
                        textPanel.removeAttribute('data-comment-editing');
                        textPanel.setAttribute('contenteditable', 'false');
                        textPanel.style.borderColor = 'rgba(251,191,36,0.4)';
                        if (save) {
                            const newText = (textPanel.textContent || '').trim().slice(0, 200);
                            const areas = commentAreasByFrame[frame] || [];
                            if (areas[areaIndex]) {
                                areas[areaIndex].t = newText;
                                renderCommentAreas();
                                updateUrlWithFrameAndAreas(getCurrentFrame1Based());
                                if (typeof renderErrorsList === 'function') renderErrorsList();
                            }
                        } else {
                            renderCommentAreas();
                        }
                    }
                    textPanel.addEventListener('dblclick', function (e) {
                        e.stopPropagation();
                        e.preventDefault();
                        isCommentTextEditing = true;
                        textPanel.setAttribute('contenteditable', 'true');
                        textPanel.setAttribute('data-comment-editing', '1');
                        textPanel.style.borderColor = 'rgba(13, 110, 253, 0.7)';
                        textPanel.focus();
                    });
                    textPanel.addEventListener('keydown', function (e) {
                        if (textPanel.getAttribute('data-comment-editing') !== '1') return;
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            exitCommentEditMode(true);
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            exitCommentEditMode(false);
                        }
                    });
                    textPanel.addEventListener('blur', function () {
                        if (textPanel.getAttribute('data-comment-editing') !== '1') return;
                        exitCommentEditMode(true);
                    });

                    // Навигация между комментариями текущего кадра
                    var areasForNav = commentAreasByFrame[frame] || [];
                    if (areasForNav.length > 1) {
                        var navContainer = document.createElement('div');
                        navContainer.style.cssText = 'margin-top:4px;display:flex;justify-content:space-between;align-items:center;gap:2px;font-size:13px';

                        // Индикатор позиции комментария: текущий/всего (например, 1/5)
                        var count = areasForNav.length;
                        var currentIndex = typeof expandedCommentAreaIndex === 'number'
                            ? expandedCommentAreaIndex
                            : areaIndex;
                        if (currentIndex < 0 || currentIndex >= count) currentIndex = 0;
                        var indexLabel = document.createElement('span');
                        indexLabel.textContent = (currentIndex + 1) + '/' + count;
                        indexLabel.style.cssText = 'color:#555;user-select:none;white-space:nowrap';

                        var prevBtn = document.createElement('button');
                        prevBtn.type = 'button';
                        prevBtn.textContent = '←';
                        prevBtn.title = 'Предыдущий комментарий';
                        prevBtn.style.cssText = 'padding:2px 6px;min-width:24px;border-radius:4px;border:1px solid rgba(108,117,125,0.6);background:rgba(248,249,250,0.95);cursor:pointer';

                        var nextBtn = document.createElement('button');
                        nextBtn.type = 'button';
                        nextBtn.textContent = '→';
                        nextBtn.title = 'Следующий комментарий';
                        nextBtn.style.cssText = 'padding:2px 6px;min-width:24px;border-radius:4px;border:1px solid rgba(108,117,125,0.6);background:rgba(248,249,250,0.95);cursor:pointer';

                        prevBtn.addEventListener('click', function (e) {
                            e.stopPropagation();
                            var list = commentAreasByFrame[frame] || [];
                            var count = list.length;
                            if (count <= 1) return;
                            var idx = typeof expandedCommentAreaIndex === 'number' ? expandedCommentAreaIndex : areaIndex;
                            if (idx < 0 || idx >= count) idx = 0;
                            var prevIndex = (idx - 1 + count) % count;
                            expandedCommentFrame = frame;
                            expandedCommentAreaIndex = prevIndex;
                            renderCommentAreas();
                        });

                        nextBtn.addEventListener('click', function (e) {
                            e.stopPropagation();
                            var list = commentAreasByFrame[frame] || [];
                            var count = list.length;
                            if (count <= 1) return;
                            var idx = typeof expandedCommentAreaIndex === 'number' ? expandedCommentAreaIndex : areaIndex;
                            if (idx < 0 || idx >= count) idx = 0;
                            var nextIndex = (idx + 1) % count;
                            expandedCommentFrame = frame;
                            expandedCommentAreaIndex = nextIndex;
                            renderCommentAreas();
                        });

                        navContainer.appendChild(indexLabel);
                        navContainer.appendChild(prevBtn);
                        navContainer.appendChild(nextBtn);
                        belowPanel.appendChild(navContainer);
                    }
                    const deleteIcon = document.createElement('button');
                    deleteIcon.type = 'button';
                    deleteIcon.title = 'Удалить комментарий';
                    deleteIcon.setAttribute('aria-label', 'Удалить комментарий');
                    deleteIcon.textContent = '🗑';
                    deleteIcon.style.cssText = 'position:absolute;top:4px;right:4px;width:24px;height:24px;padding:0;border:none;border-radius:4px;background:rgba(220,53,69,0.15);color:#dc3545;font-size:14px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center';
                    deleteIcon.addEventListener('click', function (e) {
                        e.stopPropagation();
                        isCommentTextEditing = false;
                        const areas = commentAreasByFrame[frame] || [];
                        if (areas.length > areaIndex) {
                            areas.splice(areaIndex, 1);
                            renderCommentAreas();
                            if (typeof renderErrorsList === 'function') renderErrorsList();
                            if (!hasAnyCommentAreas()) clearCommentParamsFromUrl();
                            else updateUrlWithFrameAndAreas(getCurrentFrame1Based());
                        }
                    });
                    belowPanel.appendChild(deleteIcon);
                    commentAreasContainer.appendChild(belowPanel);
                } else {
                    Object.assign(box.style, {
                        position: 'absolute',
                        left: x + '%',
                        top: y + '%',
                        width: '30px',
                        height: '30px',
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                        boxSizing: 'border-box'
                    });
                    const badge = document.createElement('div');
                    badge.setAttribute('aria-hidden', 'true');
                    Object.assign(badge.style, {
                        width: '100%',
                        height: '100%',
                        borderRadius: '8px',
                        background: 'rgba(255,255,255,0.95)',
                        border: '1px solid rgba(251, 191, 36, 0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '16px',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.12)'
                    });
                    badge.textContent = '💬';
                    box.appendChild(badge);
                    box.addEventListener('click', function (e) {
                        e.stopPropagation();
                        expandedCommentFrame = frame;
                        expandedCommentAreaIndex = areaIndex;
                        renderCommentAreas();
                    });
                    commentAreasContainer.appendChild(box);
                }
            });
        }
        if (bannerEl) {
            commentAreasOverlay = document.createElement('div');
            Object.assign(commentAreasOverlay.style, {
                position: 'fixed',
                zIndex: '9998',
                pointerEvents: 'none',
                left: '0',
                top: '0',
                width: '0',
                height: '0'
            });
            commentAreasContainer = document.createElement('div');
            Object.assign(commentAreasContainer.style, {
                position: 'absolute',
                left: '0',
                top: '0',
                width: '100%',
                height: '100%'
            });
            commentAreasOverlay.appendChild(commentAreasContainer);
            document.body.appendChild(commentAreasOverlay);
            addAreaOverlay = document.createElement('div');
            Object.assign(addAreaOverlay.style, {
                position: 'fixed',
                zIndex: '9999',
                pointerEvents: 'none',
                display: 'none',
                left: '0',
                top: '0',
                width: '0',
                height: '0'
            });
            document.body.appendChild(addAreaOverlay);
            positionCommentOverlay();
            window.addEventListener('resize', positionCommentOverlay);
            addAreaOverlay.addEventListener('mousedown', function (e) {
                if (!addAreaModeActive || addAreaDrawing) return;
                e.preventDefault();
                const r = bannerEl.getBoundingClientRect();
                addAreaStartX = e.clientX - r.left;
                addAreaStartY = e.clientY - r.top;
                addAreaDrawing = true;
                addAreaTempRect = document.createElement('div');
                Object.assign(addAreaTempRect.style, {
                    position: 'absolute',
                    left: addAreaStartX + 'px',
                    top: addAreaStartY + 'px',
                    width: '0',
                    height: '0',
                    background: 'rgba(255, 200, 0, 0.3)',
                    border: '2px dashed rgba(255, 180, 0, 0.9)',
                    pointerEvents: 'none'
                });
                addAreaOverlay.appendChild(addAreaTempRect);
            });
            window.addEventListener('mousemove', function (e) {
                if (!addAreaDrawing || !addAreaTempRect || !bannerEl) return;
                const r = bannerEl.getBoundingClientRect();
                const x = e.clientX - r.left;
                const y = e.clientY - r.top;
                const left = Math.min(addAreaStartX, x);
                const top = Math.min(addAreaStartY, y);
                const w = Math.abs(x - addAreaStartX);
                const h = Math.abs(y - addAreaStartY);
                Object.assign(addAreaTempRect.style, {
                    left: left + 'px',
                    top: top + 'px',
                    width: w + 'px',
                    height: h + 'px'
                });
            });
            window.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && addAreaModeActive) {
                    addAreaModeActive = false;
                    addAreaDrawing = false;
                    if (addAreaTempRect && addAreaTempRect.parentNode) addAreaTempRect.parentNode.removeChild(addAreaTempRect);
                    addAreaTempRect = null;
                    if (addAreaOverlay) {
                        addAreaOverlay.style.display = 'none';
                        addAreaOverlay.style.pointerEvents = 'none';
                    }
                }
            });
            window.addEventListener('mouseup', function () {
                if (!addAreaDrawing || !addAreaTempRect || !bannerEl) return;
                addAreaDrawing = false;
                const r = bannerEl.getBoundingClientRect();
                const rectLeft = parseFloat(addAreaTempRect.style.left) || 0;
                const rectTop = parseFloat(addAreaTempRect.style.top) || 0;
                const rectW = parseFloat(addAreaTempRect.style.width) || 0;
                const rectH = parseFloat(addAreaTempRect.style.height) || 0;
                if (addAreaTempRect.parentNode) addAreaTempRect.parentNode.removeChild(addAreaTempRect);
                addAreaTempRect = null;
                if (rectW < 5 || rectH < 5) {
                    addAreaModeActive = false;
                    addAreaOverlay.style.display = 'none';
                    addAreaOverlay.style.pointerEvents = 'none';
                    return;
                }
                const xPct = (rectLeft / r.width) * 100;
                const yPct = (rectTop / r.height) * 100;
                const wPct = (rectW / r.width) * 100;
                const hPct = (rectH / r.height) * 100;
                const t = window.prompt('Комментарий к области:', '');
                if (t === null) return;
                const frame = getCurrentFrame1Based();
                const creationWidth = (window.bannerWidthOverride != null || window.isWidthControlActive === true) && bannerEl
                    ? (window.bannerWidthOverride != null ? window.bannerWidthOverride : bannerEl.offsetWidth)
                    : null;
                if (!commentAreasByFrame[frame]) commentAreasByFrame[frame] = [];
                commentAreasByFrame[frame].push({ x: xPct, y: yPct, w: wPct, h: hPct, t: t.slice(0, 200), ...(creationWidth != null && { bannerWidth: creationWidth }) });
                renderCommentAreas();
                updateUrlWithFrameAndAreas(frame);
                if (typeof renderErrorsList === 'function') renderErrorsList();
                addAreaModeActive = false;
                addAreaOverlay.style.display = 'none';
                addAreaOverlay.style.pointerEvents = 'none';
            });
        }

        // === FPS drag-инпут ===
        const fpsDragContainer = document.createElement('div');
        Object.assign(fpsDragContainer.style, {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            margin: '2px 0',
            padding: '2px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '6px',
            gap: '5px',
            userSelect: 'none',
        });
        // Окно FPS
        const fpsValueBox = document.createElement('div');
        Object.assign(fpsValueBox.style, {
            minWidth: '26px',
            padding: '2px 4px',
            fontSize: '13px',
            fontWeight: 'bold',
            color: '#fff',
            background: 'rgba(30,30,30,0.85)',
            borderRadius: '6px',
            border: '1.5px solid #444',
            textAlign: 'center',
            cursor: 'ew-resize',
            letterSpacing: '0.5px',
            transition: 'background 0.15s, border 0.15s',
            outline: 'none',
            boxShadow: '0 1px 4px rgba(0,0,0,0.13)',
            userSelect: 'none',
        });
        fpsValueBox.title = 'Потяните влево/вправо для изменения FPS, двойной клик — сброс';
        fpsDragContainer.appendChild(fpsValueBox);
        btnContainer.appendChild(fpsDragContainer);
        // Логика drag
        let dragActive = false;
        let dragStartX = 0;
        let dragStartFps = 0;
        const FPS_MIN = 1;
        const FPS_MAX = 99;
        function setFps(val) {
            val = Math.round(Math.max(FPS_MIN, Math.min(FPS_MAX, val)));
            if (typeof createjs !== 'undefined' && createjs.Ticker) {
                createjs.Ticker.framerate = val;
            }
            fpsValueBox.textContent = val;
        }
        // Инициализация значения
        let initialFps = 30;
        if (typeof createjs !== 'undefined' && createjs.Ticker && createjs.Ticker.framerate) {
            initialFps = createjs.Ticker.framerate;
        }
        setFps(initialFps);
        // Drag events
        fpsValueBox.addEventListener('mousedown', (e) => {
            dragActive = true;
            dragStartX = e.clientX;
            dragStartFps = typeof createjs !== 'undefined' && createjs.Ticker ? createjs.Ticker.framerate : initialFps;
            fpsValueBox.style.background = 'rgba(60,60,60,0.95)';
            document.body.style.cursor = 'ew-resize';
        });
        window.addEventListener('mousemove', (e) => {
            if (!dragActive) return;
            const dx = e.clientX - dragStartX;
            let newFps = dragStartFps + Math.round(dx / 3); // 3px = 1 FPS
            setFps(newFps);
        });
        window.addEventListener('mouseup', () => {
            if (dragActive) {
                dragActive = false;
                fpsValueBox.style.background = 'rgba(30,30,30,0.85)';
                document.body.style.cursor = '';
            }
        });
        // Двойной клик — сброс к исходному FPS
        fpsValueBox.addEventListener('dblclick', () => {
            if (typeof createjs !== 'undefined' && createjs.Ticker && typeof ORIGINAL_FPS !== 'undefined') {
                setFps(ORIGINAL_FPS);
            }
        });
        // Синхронизация при внешнем изменении FPS
        function syncFpsBox() {
        if (typeof createjs !== 'undefined' && createjs.Ticker) {
                fpsValueBox.textContent = Math.round(createjs.Ticker.framerate);
            }
        }
        setInterval(syncFpsBox, 500);

        // === Слайдер кадров ===
        const frameSliderContainer = document.createElement('div');
        Object.assign(frameSliderContainer.style, {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
            margin: '4px 0',
            padding: '4px 0',
            background: 'rgba(0,0,0,0.18)',
            borderRadius: '6px',
            gap: '4px',
            minHeight: 'unset',
            minWidth: '0',
            justifyContent: 'center'
        });

        // Вертикальный слайдер кадров
        const frameSlider = document.createElement('input');
        frameSlider.type = 'range';
        frameSlider.min = '0';
        frameSlider.value = '0';
        Object.assign(frameSlider.style, {
            width: '18px',
            height: '90px',
            appearance: 'none',
            background: 'rgba(204, 204, 204, 0.3)',
            outline: 'none',
            borderRadius: '7px',
            cursor: 'pointer',
            writingMode: 'bt-lr',
            WebkitAppearance: 'slider-vertical',
            transform: 'rotate(180deg)',
            margin: '0 4px 0 0',
            display: 'block',
        });
        frameSlider.disabled = true;
        frameSlider.classList.add('frame-slider');
        frameSliderContainer.appendChild(frameSlider);

        // === Drag-инпут выбора кадра ===
        const frameDragBox = document.createElement('div');
        Object.assign(frameDragBox.style, {
            minWidth: '32px',
            maxWidth: '72px',
            padding: '4px 8px',
            fontSize: '14px',
            fontWeight: 'bold',
            color: '#fff',
            background: 'rgba(30,30,30,0.85)',
            borderRadius: '6px',
            border: '1.5px solid #444',
            textAlign: 'center',
            cursor: 'ew-resize',
            letterSpacing: '0.5px',
            transition: 'background 0.15s, border 0.15s',
            outline: 'none',
            boxShadow: '0 1px 4px rgba(0,0,0,0.13)',
            userSelect: 'none',
            margin: '4px 0 0 0',
            alignSelf: 'center',
        });
            frameDragBox.title = 'Потяните влево/вправо для выбора кадра, двойной клик — редактировать кадр';
        frameSliderContainer.appendChild(frameDragBox);

        let initialFrameFromUrlApplied = false;
        function updateUrlWithFrame(frame1Based) {
            const params = new URLSearchParams(window.location.search);
            params.set('frame', String(frame1Based));
            const newUrl = window.location.pathname + '?' + params.toString();
            history.replaceState(null, '', newUrl);
        }
        function clearCommentParamsFromUrl() {
            const params = new URLSearchParams(window.location.search);
            params.delete('frame');
            params.delete('areas');
            const query = params.toString();
            const newUrl = window.location.pathname + (query ? '?' + query : '');
            history.replaceState(null, '', newUrl);
        }
        function hasAnyCommentAreas() {
            return Object.keys(commentAreasByFrame).some(function (f) {
                return commentAreasByFrame[f] && commentAreasByFrame[f].length > 0;
            });
        }
        function updateUrlWithFrameAndAreas(frame1Based) {
            const params = new URLSearchParams(window.location.search);
            params.set('frame', String(frame1Based));
            const obj = {};
            Object.keys(commentAreasByFrame).forEach(function (f) {
                const n = parseInt(f, 10);
                if (n >= 1 && commentAreasByFrame[n] && commentAreasByFrame[n].length > 0) {
                    obj[f] = commentAreasByFrame[n];
                }
            });
            if (Object.keys(obj).length > 0) {
                params.set('areas', encodeURIComponent(JSON.stringify(obj)));
            } else {
                params.delete('areas');
            }
            const newUrl = window.location.pathname + '?' + params.toString();
            history.replaceState(null, '', newUrl);
        }

            // Переменные для режима редактирования
            let isFrameEditing = false;
            let originalFrameValue = '';
            let frameInput = null; // Временный input элемент

        // Логика drag для кадров
        let frameDragActive = false;
        let frameDragStartX = 0;
        let frameDragStartVal = 1;
        let frameDragMax = 1;
        function setFrameDrag(val) {
            val = Math.max(1, Math.min(frameDragMax, Math.round(val)));
            if (typeof window.exportRoot !== 'undefined' && typeof window.exportRoot.gotoAndStop === 'function') {
                    // Ставим анимацию на паузу при ручном изменении кадра
                    window.exportRoot.paused = true;
                window.exportRoot.gotoAndStop(val - 1);
                fullUpdateSlider();
                    // Обновляем кнопку плей/пауза
                    updatePauseButton();
                updateUrlWithFrameAndAreas(val);
            }
                if (!isFrameEditing) {
            frameDragBox.textContent = val;
        }
            }

            // Функция для входа в режим редактирования
            function enterFrameEditMode() {
                if (isFrameEditing) return;

                // Ставим анимацию на паузу при входе в режим редактирования
                if (typeof window.exportRoot !== 'undefined') {
                    window.exportRoot.paused = true;
                    updatePauseButton();
                }

                isFrameEditing = true;
                originalFrameValue = frameDragBox.textContent;

                // Получаем точные размеры и позицию оригинального элемента
                const rect = frameDragBox.getBoundingClientRect();
                const computedStyle = window.getComputedStyle(frameDragBox);

                // ВАЖНО: Учитываем масштабирование панели!
                // Получаем текущий масштаб панели
                const currentScale = (1 / window.devicePixelRatio) * panelScaleFactor;

                // Вычисляем реальные размеры без учета масштабирования
                const realWidth = rect.width / currentScale;
                const realHeight = rect.height / currentScale;

                // Вычисляем позицию относительно панели без учета масштабирования
                const panelRect = panel.getBoundingClientRect();
                const relativeLeft = (rect.left - panelRect.left) / currentScale;
                const relativeTop = (rect.top - panelRect.top) / currentScale;

                // Создаем ПРОСТОЙ contentEditable div БЕЗ учета масштабирования
                frameInput = document.createElement('div');
                frameInput.contentEditable = true;
                frameInput.textContent = frameDragBox.textContent;

                // Применяем стили с реальными размерами (панель сама масштабирует)
                frameInput.style.cssText = `
                    position: absolute !important;
                    left: ${relativeLeft}px !important;
                    top: ${relativeTop}px !important;
                    width: ${realWidth}px !important;
                    height: ${realHeight}px !important;
                    max-width: ${realWidth}px !important;
                    min-width: ${realWidth}px !important;
                    max-height: ${realHeight}px !important;
                    min-height: ${realHeight}px !important;
                    overflow: hidden !important;
                    white-space: nowrap !important;
                    text-overflow: clip !important;
                    box-sizing: border-box !important;
                    margin: 0 !important;
                    padding: ${computedStyle.padding} !important;
                    font-size: ${computedStyle.fontSize} !important;
                    font-weight: ${computedStyle.fontWeight} !important;
                    font-family: ${computedStyle.fontFamily} !important;
                    color: #fff !important;
                    background: rgba(60,120,180,0.95) !important;
                    border-radius: ${computedStyle.borderRadius} !important;
                    border: 1.5px solid #4CAF50 !important;
                    text-align: center !important;
                    letter-spacing: ${computedStyle.letterSpacing} !important;
                    outline: none !important;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.13) !important;
                    resize: none !important;
                    z-index: 10001 !important;
                    user-select: text !important;
                    cursor: text !important;
                    line-height: ${computedStyle.lineHeight} !important;
                    display: block !important;
                    flex-shrink: 0 !important;
                    flex-grow: 0 !important;
                    word-wrap: normal !important;
                    word-break: normal !important;
                `;

                frameInput.title = 'Введите номер кадра и нажмите Enter';

                // Скрываем оригинальный элемент и добавляем contentEditable div В ПАНЕЛЬ
                frameDragBox.style.visibility = 'hidden';
                // Добавляем напрямую в панель, а не в родителя frameDragBox
                panel.appendChild(frameInput);

                // Фокусируемся и выделяем текст
                frameInput.focus();

                // Выделяем весь текст в contentEditable
                if (window.getSelection && document.createRange) {
                    const range = document.createRange();
                    range.selectNodeContents(frameInput);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                }

                // Обработчики для contentEditable div
                frameInput.addEventListener('keydown', handleFrameInputKeydown);
                frameInput.addEventListener('blur', handleFrameInputBlur);
                frameInput.addEventListener('input', handleFrameInputInput);
            }

            // Функция для выхода из режима редактирования
            function exitFrameEditMode(save = false) {
                if (!isFrameEditing || !frameInput) return;

                isFrameEditing = false;

                if (save) {
                    const newValue = parseInt(frameInput.textContent.trim(), 10);
                    if (!isNaN(newValue) && newValue >= 1 && newValue <= frameDragMax) {
                        setFrameDrag(newValue);
                    } else {
                        // Восстанавливаем исходное значение при неверном вводе
                        frameDragBox.textContent = originalFrameValue;
                    }
                } else {
                    // Отменяем изменения
                    frameDragBox.textContent = originalFrameValue;
                }

                // Удаляем contentEditable div из панели и показываем оригинальный элемент
                if (frameInput && frameInput.parentNode) {
                    frameInput.parentNode.removeChild(frameInput);
                }
                frameInput = null;
                frameDragBox.style.visibility = 'visible';
            }

            // Обработчики событий для input
            function handleFrameInputKeydown(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    exitFrameEditMode(true); // Сохраняем изменения
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    exitFrameEditMode(false); // Отменяем изменения
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    exitFrameEditMode(true); // Сохраняем при Tab
                }
            }

            function handleFrameInputBlur() {
                // Небольшая задержка, чтобы обработались другие события
                setTimeout(() => {
                    if (isFrameEditing) {
                        exitFrameEditMode(true);
                    }
                }, 100);
            }

            function handleFrameInputInput(e) {
                // Ограничиваем ввод только цифрами для contentEditable
                const value = e.target.textContent.replace(/[^0-9]/g, '');
                if (e.target.textContent !== value) {
                    e.target.textContent = value;

                    // Перемещаем курсор в конец после изменения
                    if (window.getSelection && document.createRange) {
                        const range = document.createRange();
                        range.selectNodeContents(e.target);
                        range.collapse(false);
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                }
            }

        frameDragBox.addEventListener('mousedown', (e) => {
                if (isFrameEditing) return; // Игнорируем drag в режиме редактирования

            frameDragActive = true;
            frameDragStartX = e.clientX;
            frameDragStartVal = parseInt(frameDragBox.textContent, 10) || 1;
            frameDragBox.style.background = 'rgba(60,60,60,0.95)';
            document.body.style.cursor = 'ew-resize';
        });
        window.addEventListener('mousemove', (e) => {
                if (!frameDragActive || isFrameEditing) return; // Игнорируем в режиме редактирования
            const dx = e.clientX - frameDragStartX;
            let newVal = frameDragStartVal + Math.round(dx / 4); // 4px = 1 кадр
            setFrameDrag(newVal);
        });
        window.addEventListener('mouseup', () => {
            if (frameDragActive) {
                frameDragActive = false;
                frameDragBox.style.background = 'rgba(30,30,30,0.85)';
                document.body.style.cursor = '';
            }
        });

            // Двойной клик — режим редактирования
            frameDragBox.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                enterFrameEditMode();
            });

            // Обработка клавиш в режиме редактирования
            frameDragBox.addEventListener('keydown', (e) => {
                if (!isFrameEditing) return;

                if (e.key === 'Enter') {
                    e.preventDefault();
                    exitFrameEditMode(true); // Сохраняем изменения
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    exitFrameEditMode(false); // Отменяем изменения
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    exitFrameEditMode(true); // Сохраняем при Tab
                }
            });

            // Выход из режима редактирования при потере фокуса
            frameDragBox.addEventListener('blur', () => {
                if (isFrameEditing) {
                    // Небольшая задержка, чтобы обработались другие события
                    setTimeout(() => {
                        if (isFrameEditing) {
                            exitFrameEditMode(true);
                        }
                    }, 100);
                }
            });

            // Ограничиваем ввод только цифрами
            frameDragBox.addEventListener('input', (e) => {
                if (!isFrameEditing) return;

                // Удаляем все нецифровые символы
                const value = frameDragBox.textContent.replace(/[^0-9]/g, '');
                if (frameDragBox.textContent !== value) {
                    frameDragBox.textContent = value;

                    // Перемещаем курсор в конец
                    if (window.getSelection && document.createRange) {
                        const range = document.createRange();
                        range.selectNodeContents(frameDragBox);
                        range.collapse(false);
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                }
            });

        // Синхронизация при внешнем изменении кадра
        function syncFrameDragBox() {
            if (typeof window.exportRoot !== 'undefined') {
                let currentFrame = 0;
                let totalFrames = 1;
                if (typeof window.exportRoot.currentFrame === 'number') {
                    currentFrame = window.exportRoot.currentFrame;
                } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.position === 'number') {
                    currentFrame = window.exportRoot.timeline.position;
                }
                if (typeof window.exportRoot.totalFrames === 'number') {
                    totalFrames = window.exportRoot.totalFrames;
                } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.duration === 'number') {
                    totalFrames = window.exportRoot.timeline.duration;
                }
                frameDragMax = totalFrames;
                    if (!isFrameEditing) {
                frameDragBox.textContent = (currentFrame + 1).toString();
                    }
            }
        }
        setInterval(syncFrameDragBox, 300);

        // Добавляем стили для тонкого трека и круглого маркера
        const frameSliderStyles = `
            input[type=range].frame-slider::-webkit-slider-thumb {
                appearance: none;
                width: 22px;
                height: 22px;
                background: #E0E0E0;
                border-radius: 50%;
                box-shadow: 0 2px 4px rgba(0,0,0,0.13);
                border: 1px solid rgba(142, 142, 147, 0.5);
                margin-top: -9px;
            }
            input[type=range].frame-slider::-moz-range-thumb {
                width: 22px;
                height: 22px;
                background: #E0E0E0;
                border-radius: 50%;
                box-shadow: 0 2px 4px rgba(0,0,0,0.13);
                border: 1px solid rgba(142, 142, 147, 0.5);
            }
            input[type=range].frame-slider::-webkit-slider-runnable-track {
                height: 8px;
                background: rgba(204, 204, 204, 0.5);
                border-radius: 4px;
            }
            input[type=range].frame-slider::-moz-range-track {
                height: 8px;
                background: rgba(204, 204, 204, 0.5);
                border-radius: 4px;
            }
            input[type=range].frame-slider {
                background: transparent;
                padding: 0;
                margin: 0;
            }
        `;
        const frameSliderStyleElement = document.createElement('style');
        frameSliderStyleElement.textContent = frameSliderStyles;
        document.head.appendChild(frameSliderStyleElement);

        // Обновление слайдера в реальном времени
        let isRafActive = true;
        let lastFrame = -1; // Для отслеживания изменений кадра
        let frameHistory = []; // История последних кадров

        function rafUpdateSlider() {
            if (isRafActive) {
                if (typeof window.exportRoot !== 'undefined') {
                    let currentFrame = 0;

                    // Получаем текущий кадр
                    if (typeof window.exportRoot.currentFrame === 'number') {
                        currentFrame = window.exportRoot.currentFrame;
                    } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.position === 'number') {
                        currentFrame = window.exportRoot.timeline.position;
                    }

                    // Проверяем, изменился ли кадр
                    if (currentFrame !== lastFrame) {
                        // Обновляем слайдер только если не перетаскиваем его
                        if (!frameDragActive) {
                            frameSlider.value = currentFrame.toString();
                            frameDragBox.textContent = (currentFrame + 1).toString();
                        }

                        // Сохраняем историю кадров для отладки
                        frameHistory.push(currentFrame);
                        if (frameHistory.length > 10) {
                            frameHistory.shift();
                        }

                        lastFrame = currentFrame;
                    }
                }

                requestAnimationFrame(rafUpdateSlider);
            }
        }
        requestAnimationFrame(rafUpdateSlider);

        // Полное обновление слайдера (включая min/max)
        function fullUpdateSlider() {
            if (typeof window.exportRoot !== 'undefined') {
                let totalFrames = 0;
                let currentFrame = 0;

                // Получаем общее количество кадров
                if (typeof window.exportRoot.totalFrames === 'number') {
                    totalFrames = window.exportRoot.totalFrames;
                } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.duration === 'number') {
                    totalFrames = window.exportRoot.timeline.duration;
                }

                // Получаем текущий кадр
                if (typeof window.exportRoot.currentFrame === 'number') {
                    currentFrame = window.exportRoot.currentFrame;
                } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.position === 'number') {
                    currentFrame = window.exportRoot.timeline.position;
                }

                if (totalFrames > 0) {
                    frameSlider.max = (totalFrames - 1).toString();

                    // Обновляем положение слайдера только если не перетаскиваем его
                    if (!frameDragActive) {
                        frameSlider.value = currentFrame.toString();
                        frameDragBox.textContent = (currentFrame + 1).toString();
                    }

                    frameSlider.disabled = false;

                    // Однократно применить кадр и области из GET-параметров ?frame=N и ?areas=...
                    if (!initialFrameFromUrlApplied) {
                        initialFrameFromUrlApplied = true;
                        const params = new URLSearchParams(window.location.search);
                        const frameParam = params.get('frame');
                        if (frameParam !== null && frameParam !== '') {
                            let frame1 = parseInt(frameParam, 10);
                            if (!isNaN(frame1) && frame1 >= 1 && frame1 <= totalFrames) {
                                window.exportRoot.gotoAndStop(frame1 - 1);
                                window.exportRoot.paused = true;
                                frameSlider.value = (frame1 - 1).toString();
                                frameDragBox.textContent = String(frame1);
                                if (typeof updatePauseButton === 'function') updatePauseButton();
                                const areasParam = params.get('areas');
                                if (areasParam) {
                                    try {
                                        const decoded = decodeURIComponent(areasParam);
                                        const parsed = JSON.parse(decoded);
                                        function validateAreasArray(arr) {
                                            if (!Array.isArray(arr)) return [];
                                            return arr.filter(function (a) {
                                                return a && typeof a.x === 'number' && typeof a.y === 'number' && typeof a.w === 'number' && typeof a.h === 'number';
                                            }).map(function (a) {
                                                return { x: a.x, y: a.y, w: a.w, h: a.h, t: (a.t != null ? String(a.t).slice(0, 200) : ''), ...(typeof a.bannerWidth === 'number' && a.bannerWidth > 0 ? { bannerWidth: a.bannerWidth } : {}) };
                                            });
                                        }
                                        if (Array.isArray(parsed)) {
                                            commentAreasByFrame[frame1] = validateAreasArray(parsed);
                                        } else if (parsed && typeof parsed === 'object') {
                                            commentAreasByFrame = {};
                                            Object.keys(parsed).forEach(function (key) {
                                                const f = parseInt(key, 10);
                                                if (!isNaN(f) && f >= 1) {
                                                    commentAreasByFrame[f] = validateAreasArray(parsed[key]);
                                                }
                                            });
                                        }
                                    } catch (err) {
                                        console.warn('[AniPlay] Не удалось разобрать параметр areas:', err);
                                    }
                                }
                                if (typeof renderCommentAreas === 'function') renderCommentAreas();
                                if (typeof renderErrorsList === 'function') renderErrorsList();
                            }
                        }
                    }
                } else {
                    frameSlider.disabled = true;
                    frameDragBox.textContent = '-';
                }
            } else {
                frameSlider.disabled = true;
                frameDragBox.textContent = '-';
            }
            if (typeof renderCommentAreas === 'function') renderCommentAreas();
            if (typeof positionCommentOverlay === 'function') positionCommentOverlay();
        }

        // Периодически делаем полное обновление слайдера
        const fullUpdateInterval = setInterval(fullUpdateSlider, 300);

        // Слайдер перемещает по кадрам
        frameSlider.addEventListener('input', () => {
            if (typeof window.exportRoot !== 'undefined') {
                const frame = parseInt(frameSlider.value, 10);
                if (typeof window.exportRoot.gotoAndStop === 'function') {
                        // Ставим анимацию на паузу при ручном изменении кадра
                        window.exportRoot.paused = true;
                    window.exportRoot.gotoAndStop(frame);
                    fullUpdateSlider();
                    lastFrame = frame; // Обновляем lastFrame чтобы избежать ненужных обновлений
                        // Обновляем кнопку плей/пауза
                        updatePauseButton();
                    updateUrlWithFrameAndAreas(frame + 1);
                }
            }
        });

        // При удалении панели очищаем requestAnimationFrame и интервал
        panel.addEventListener('remove', () => {
            isRafActive = false;
            clearInterval(fullUpdateInterval);
        });

        // === Кнопка и контейнер для маркеров ===
        const markerRow = document.createElement('div');
        Object.assign(markerRow.style, {
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
            margin: '4px 0 0 0',
            maxHeight: '200px', // Ограничиваем высоту
            overflowY: 'auto', // Добавляем прокрутку если маркеров много
            overflowX: 'hidden',
            width: '100%',
            minWidth: '0',
            alignItems: 'center',
            minHeight: '28px',
            padding: '2px'
        });
        frameSliderContainer.appendChild(markerRow);

            // === Контейнер для кнопок управления маркерами (макс. 2 в ряд, иконки) ===
            const markerButtonsContainer = document.createElement('div');
            Object.assign(markerButtonsContainer.style, {
                display: 'flex',
                flexWrap: 'wrap',
                gap: '4px',
                margin: '0 0 4px 0',
                justifyContent: 'center',
                alignItems: 'center',
                width: '100%'
            });
            frameSliderContainer.appendChild(markerButtonsContainer);

        function createIconBtn(iconName, title, bgColor, hoverColor) {
            const btn = document.createElement('button');
            const icon = document.createElement('span');
            icon.className = 'material-icons';
            icon.style.fontSize = '20px';
            icon.textContent = iconName;
            btn.appendChild(icon);
            btn.title = title;
            Object.assign(btn.style, {
                width: 'calc(50% - 2px)',
                minWidth: '36px',
                height: '32px',
                padding: '0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                border: 'none',
                background: bgColor,
                color: '#fff',
                cursor: 'pointer',
                transition: 'background 0.2s',
                outline: 'none',
                boxShadow: '0 1px 3px rgba(0,0,0,0.13)'
            });
            btn.addEventListener('mouseenter', () => { btn.style.background = hoverColor; });
            btn.addEventListener('mouseleave', () => { btn.style.background = bgColor; });
            return { btn, icon };
        }

        const addMarkerBtnEl = createIconBtn('add', 'Добавить маркер на этот кадр', '#3a3a3a', '#555');
        const addMarkerBtn = addMarkerBtnEl.btn;
        markerButtonsContainer.appendChild(addMarkerBtn);

            const clearMarkersBtnEl = createIconBtn('clear', 'Очистить все маркеры', '#b33', '#d44');
            const clearMarkersBtn = clearMarkersBtnEl.btn;
            clearMarkersBtn.addEventListener('click', () => {
                if (frameMarkers.length > 0 && confirm(`Удалить все ${frameMarkers.length} маркеров?`)) {
                    frameMarkers = [];
                    renderMarkers();
                    saveFrameMarkers();
                    updateMarkersVisibility();
                    console.log('[Frame Markers] Все маркеры очищены');
                }
            });
            markerButtonsContainer.appendChild(clearMarkersBtn);

            const copyLinkBtnEl = createIconBtn('link', 'Скопировать ссылку на этот кадр', '#3a5a8a', '#4a6a9a');
            const copyLinkBtn = copyLinkBtnEl.btn;
            const copyLinkIcon = copyLinkBtnEl.icon;
            copyLinkBtn.addEventListener('click', () => {
                let currentFrame = 0;
                if (typeof window.exportRoot !== 'undefined') {
                    if (typeof window.exportRoot.currentFrame === 'number') {
                        currentFrame = window.exportRoot.currentFrame;
                    } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.position === 'number') {
                        currentFrame = window.exportRoot.timeline.position;
                    }
                }
                const frame1Based = currentFrame + 1;
                const params = new URLSearchParams(window.location.search);
                params.set('frame', String(frame1Based));
                const obj = {};
                Object.keys(commentAreasByFrame).forEach(function (f) {
                    const n = parseInt(f, 10);
                    if (n >= 1 && commentAreasByFrame[n] && commentAreasByFrame[n].length > 0) {
                        obj[f] = commentAreasByFrame[n];
                    }
                });
                if (Object.keys(obj).length > 0) {
                    params.set('areas', encodeURIComponent(JSON.stringify(obj)));
                } else {
                    params.delete('areas');
                }
                const url = window.location.origin + window.location.pathname + '?' + params.toString();
                navigator.clipboard.writeText(url).then(() => {
                    copyLinkIcon.textContent = 'done';
                    copyLinkBtn.style.background = '#2a7a2a';
                    copyLinkBtn.title = 'Скопировано!';
                    setTimeout(() => {
                        copyLinkIcon.textContent = 'link';
                        copyLinkBtn.style.background = '#3a5a8a';
                        copyLinkBtn.title = 'Скопировать ссылку на этот кадр';
                    }, 1500);
                }).catch(() => {
                    copyLinkIcon.textContent = 'error';
                    copyLinkBtn.title = 'Ошибка';
                    setTimeout(() => {
                        copyLinkIcon.textContent = 'link';
                        copyLinkBtn.title = 'Скопировать ссылку на этот кадр';
                    }, 1500);
                });
            });
            markerButtonsContainer.appendChild(copyLinkBtn);

            const addAreaBtnEl = createIconBtn('rate_review', 'Добавить область с комментарием', '#5a4a8a', '#6a5a9a');
            const addAreaBtn = addAreaBtnEl.btn;
            addAreaBtn.addEventListener('click', () => {
                if (!bannerEl || !addAreaOverlay) return;
                addAreaModeActive = true;
                addAreaOverlay.style.display = 'block';
                addAreaOverlay.style.pointerEvents = 'auto';
                positionCommentOverlay();
            });
            markerButtonsContainer.appendChild(addAreaBtn);

            const clearAreasBtnEl = createIconBtn('delete_sweep', 'Очистить области с комментариями на этом кадре', '#8a4a4a', '#9a5a5a');
            const clearAreasBtn = clearAreasBtnEl.btn;
            clearAreasBtn.addEventListener('click', () => {
                const frame = getCurrentFrame1Based();
                commentAreasByFrame[frame] = [];
                renderCommentAreas();
                if (typeof renderErrorsList === 'function') renderErrorsList();
                if (!hasAnyCommentAreas()) {
                    clearCommentParamsFromUrl();
                    if (typeof window.exportRoot !== 'undefined' && typeof window.exportRoot.gotoAndStop === 'function') {
                        window.exportRoot.gotoAndStop(0);
                        window.exportRoot.paused = false;
                        if (typeof fullUpdateSlider === 'function') fullUpdateSlider();
                        if (typeof updatePauseButton === 'function') updatePauseButton();
                    }
                } else {
                    updateUrlWithFrameAndAreas(getCurrentFrame1Based());
                }
            });
            markerButtonsContainer.appendChild(clearAreasBtn);

            // === Список замечаний (переход по кадрам и областям) ===
            const errorsListSection = document.createElement('div');
            Object.assign(errorsListSection.style, {
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                marginTop: '6px',
                width: '100%',
                minWidth: '0',
                minHeight: '28px'
            });
            const errorsListTitle = document.createElement('div');
            errorsListTitle.textContent = 'Список замечаний';
            Object.assign(errorsListTitle.style, {
                fontSize: '11px',
                fontWeight: 'bold',
                color: 'rgba(255,255,255,0.9)'
            });
            errorsListSection.appendChild(errorsListTitle);
            const errorsListContainer = document.createElement('div');
            Object.assign(errorsListContainer.style, {
                maxHeight: '180px',
                minWidth: '0',
                overflowY: 'auto',
                overflowX: 'hidden',
                background: 'rgba(0,0,0,0.25)',
                borderRadius: '6px',
                padding: '4px'
            });
            errorsListSection.appendChild(errorsListContainer);
            frameSliderContainer.appendChild(errorsListSection);

            function renderErrorsList() {
                errorsListContainer.innerHTML = '';
                const items = getErrorsListItems();
                const currentFrame = getCurrentFrame1Based();
                if (items.length === 0) {
                    const empty = document.createElement('div');
                    empty.textContent = 'Нет замечаний';
                    Object.assign(empty.style, { fontSize: '12px', color: 'rgba(255,255,255,0.6)', padding: '4px' });
                    errorsListContainer.appendChild(empty);
                    return;
                }
                items.forEach(function (item) {
                    const btn = document.createElement('button');
                    const preview = item.text ? (item.text.length > 45 ? item.text.slice(0, 45) + '…' : item.text) : '(без текста)';
                    const widthSuffix = item.bannerWidth != null ? ' при ' + item.bannerWidth + 'px' : '';
                    btn.textContent = 'Кадр ' + item.frame + ': ' + preview + widthSuffix;
                    btn.title = item.bannerWidth != null ? 'Создан при ширине баннера ' + item.bannerWidth + 'px' : '';
                    Object.assign(btn.style, {
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '6px 8px',
                        marginBottom: '2px',
                        fontSize: '11px',
                        color: '#fff',
                        background: (item.frame === currentFrame ? 'rgba(80,120,180,0.5)' : 'rgba(40,40,40,0.6)'),
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    });
                    btn.addEventListener('mouseenter', function () {
                        if (item.frame !== currentFrame) btn.style.background = 'rgba(60,60,60,0.8)';
                    });
                    btn.addEventListener('mouseleave', function () {
                        btn.style.background = (item.frame === currentFrame ? 'rgba(80,120,180,0.5)' : 'rgba(40,40,40,0.6)');
                    });
                    btn.addEventListener('click', function () {
                        if (typeof window.exportRoot === 'undefined' || typeof window.exportRoot.gotoAndStop !== 'function') return;
                        window.exportRoot.paused = true;
                        window.exportRoot.gotoAndStop(item.frame - 1);
                        fullUpdateSlider();
                        if (typeof updatePauseButton === 'function') updatePauseButton();
                        updateUrlWithFrameAndAreas(item.frame);
                        if (item.bannerWidth != null && typeof window.setBannerWidthOverride === 'function' && typeof window.applyBannerWidthAndUpdateUI === 'function') {
                            window.setBannerWidthOverride(item.bannerWidth);
                            window.applyBannerWidthAndUpdateUI();
                        }
                        renderCommentAreas();
                        renderErrorsList();
                        var areaEl = commentAreasContainer && commentAreasContainer.querySelector('[data-area-index="' + item.areaIndex + '"]');
                        if (areaEl) {
                            areaEl.style.boxShadow = '0 0 0 3px rgba(255,200,0,0.9)';
                            areaEl.style.background = 'rgba(255,220,0,0.4)';
                            setTimeout(function () {
                                areaEl.style.boxShadow = '';
                                areaEl.style.background = 'rgba(255, 200, 0, 0.25)';
                            }, 1500);
                        }
                    });
                    errorsListContainer.appendChild(btn);
                });
            }
            renderErrorsList();

        let frameMarkers = [];

            // === Функции для сохранения и загрузки маркеров ===
            function saveFrameMarkers() {
                try {
                    localStorage.setItem('animateFrameMarkers', JSON.stringify(frameMarkers));
                    console.log('[Frame Markers] Маркеры сохранены:', frameMarkers);
                } catch(e) {
                    console.warn('[Frame Markers] Ошибка при сохранении маркеров:', e);
                }
            }

            function loadFrameMarkers() {
                try {
                    const saved = localStorage.getItem('animateFrameMarkers');
                    if (saved) {
                        const parsedMarkers = JSON.parse(saved);
                        if (Array.isArray(parsedMarkers)) {
                            frameMarkers = parsedMarkers.filter(marker =>
                                typeof marker === 'number' && marker >= 0
                            );
                            if (frameMarkers.length > 0) {
                                console.log(`[Frame Markers] Загружено ${frameMarkers.length} сохраненных маркеров:`, frameMarkers.map(f => f + 1));
                                renderMarkers();
                            } else {
                                console.log('[Frame Markers] Сохраненные маркеры не найдены');
                            }
                        }
                    } else {
                        console.log('[Frame Markers] Нет сохраненных маркеров');
                    }
                } catch(e) {
                    console.warn('[Frame Markers] Ошибка при загрузке маркеров:', e);
                    frameMarkers = [];
                }
            }

            // Загружаем сохраненные маркеры при инициализации
            loadFrameMarkers();

            // Устанавливаем правильную видимость при инициализации
            setTimeout(() => {
                updateMarkersVisibility();
            }, 100);

            // Функция для управления видимостью контейнеров маркеров
            function updateMarkersVisibility() {
                const hasMarkers = frameMarkers.length > 0;

                // Показываем/скрываем контейнер с маркерами
                markerRow.style.display = hasMarkers ? 'flex' : 'none';

                // Кнопки управления показываем всегда, но меняем margin
                if (hasMarkers) {
                    // Если есть маркеры - обычный отступ
                    markerButtonsContainer.style.margin = '0 0 4px 0';
                } else {
                    // Если маркеров нет - убираем верхний отступ чтобы не было пустого места
                    markerButtonsContainer.style.margin = '4px 0 4px 0';
                }

                console.log(`[Frame Markers] Обновлена видимость: hasMarkers=${hasMarkers}`);
            }

        function renderMarkers() {
            markerRow.innerHTML = '';
            frameMarkers.sort((a, b) => a - b);
            frameMarkers.forEach(frame => {
                const btn = document.createElement('button');
                btn.style.position = 'relative';
                btn.style.display = 'flex';
                btn.style.alignItems = 'center';
                btn.style.justifyContent = 'space-between';
                Object.assign(btn.style, {
                    width: '44px',
                    height: '20px',
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#e0e0e0',
                    color: '#222',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    margin: '1px 0',
                    padding: '0 6px',
                    transition: 'background 0.2s',
                    outline: 'none',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.10)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                });
                btn.title = `Перейти к кадру ${frame + 1}`;
                btn.addEventListener('mouseenter', () => { btn.style.background = '#bdbdbd'; });
                btn.addEventListener('mouseleave', () => { btn.style.background = '#e0e0e0'; });
                // Клик по номеру — переход
                btn.addEventListener('click', (e) => {
                    // Если клик по крестику — не переходить
                    if (e.target.classList.contains('marker-remove')) return;
                    if (typeof window.exportRoot !== 'undefined' && typeof window.exportRoot.gotoAndStop === 'function') {
                            // Ставим анимацию на паузу при переходе к кадру через маркер
                            window.exportRoot.paused = true;
                        window.exportRoot.gotoAndStop(frame);
                        fullUpdateSlider();
                            // Обновляем кнопку плей/пауза
                            updatePauseButton();
                    }
                });
                // Номер кадра
                const numSpan = document.createElement('span');
                numSpan.textContent = (frame + 1).toString();
                numSpan.style.pointerEvents = 'none';
                btn.appendChild(numSpan);
                // Крестик для удаления
                const removeBtn = document.createElement('span');
                removeBtn.textContent = '×';
                removeBtn.className = 'marker-remove';
                Object.assign(removeBtn.style, {
                    fontSize: '14px',
                    color: '#b00',
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                    userSelect: 'none',
                    lineHeight: '1',
                    fontWeight: 'bold',
                    padding: '0 0 0 4px'
                });
                removeBtn.title = 'Удалить маркер';
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    frameMarkers = frameMarkers.filter(f => f !== frame);
                    renderMarkers();
                        saveFrameMarkers(); // Сохраняем после удаления
                        updateMarkersVisibility(); // Обновляем видимость после удаления
                });
                btn.appendChild(removeBtn);
                markerRow.appendChild(btn);
            });

                // Обновляем видимость после рендеринга
                updateMarkersVisibility();
        }

        addMarkerBtn.addEventListener('click', () => {
            let val = parseInt(frameDragBox.textContent, 10);
            if (isNaN(val) || val < 1) return;
            const frame = val - 1;
            if (!frameMarkers.includes(frame)) {
                frameMarkers.push(frame);
                renderMarkers();
                    saveFrameMarkers(); // Сохраняем после добавления
                    updateMarkersVisibility(); // Обновляем видимость после добавления
            }
        });

        btnContainer.appendChild(frameSliderContainer);

        // Добавляем кнопку паузы
        const pauseBtn = document.createElement('button');
        const pauseIcon = document.createElement('span');
        pauseIcon.className = 'material-icons';
        pauseIcon.textContent = 'pause'; // Начальное состояние - показываем паузу (т.к. анимация по умолчанию воспроизводится)
        pauseBtn.appendChild(pauseIcon);
        pauseBtn.title = 'Остановить воспроизведение';
        Object.assign(pauseBtn.style, {
            width: '44px',
            height: '44px',
            padding: '0',
            margin: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)',
            border: 'none',
            borderRadius: '6px',
            color: '#fff',
            cursor: 'pointer',
            transition: 'background 0.2s',
            fontSize: '22px'
        });

        // hover
        pauseBtn.addEventListener('mouseenter', () => { pauseBtn.style.background = 'rgba(255,255,255,0.2)'; });
        pauseBtn.addEventListener('mouseleave', () => { pauseBtn.style.background = 'rgba(0,0,0,0.5)'; });

        // Обновление иконки и заголовка в зависимости от состояния
        function updatePauseButton() {
            if (typeof window.exportRoot !== 'undefined') {
                if (window.exportRoot.paused) {
                    pauseIcon.textContent = 'play_arrow';
                    pauseBtn.title = 'Запустить воспроизведение';
                } else {
                    pauseIcon.textContent = 'pause';
                    pauseBtn.title = 'Остановить воспроизведение';
                }
            }
        }

        // Обработчик клика
        pauseBtn.addEventListener('click', () => {
            if (typeof window.exportRoot !== 'undefined') {
                window.exportRoot.paused = !window.exportRoot.paused;
                updatePauseButton();
                console.log(`[Paused toggle] ${window.exportRoot.paused}`);
            }
        });

        btnContainer.appendChild(pauseBtn);

        // === Кнопка сворачивания ===
        const collapseBtn = document.createElement('button');
        const collapseIcon = document.createElement('span');
        collapseIcon.className = 'material-icons';
        collapseIcon.textContent = 'chevron_left';
        collapseBtn.appendChild(collapseIcon);
        Object.assign(collapseBtn.style, {
            position: 'absolute',
            top: '8px',
            left: '8px',
            right: 'auto',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.18)',
            border: 'none',
            borderRadius: '50%',
            color: '#fff',
            cursor: 'pointer',
            zIndex: '10001',
            fontSize: '22px',
            transition: 'background 0.2s',
        });
        collapseBtn.addEventListener('mouseenter', () => { collapseBtn.style.background = 'rgba(255,255,255,0.18)'; });
        collapseBtn.addEventListener('mouseleave', () => { collapseBtn.style.background = 'rgba(0,0,0,0.18)'; });
        panel.appendChild(collapseBtn);
        panel.style.position = 'fixed';
        panel.style.top = '16px';
        panel.style.left = '16px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.minWidth = '52px';
        panel.style.minHeight = '52px';
        panel.style.boxSizing = 'border-box';
        panel.style.paddingTop = '36px';
        // Состояние
        let isCollapsed = false;
        // Восстанавливаем состояние из localStorage
        const savedPanelCollapsed = localStorage.getItem('animatePanelCollapsed');
        if (savedPanelCollapsed === 'true') isCollapsed = true;
        function setPanelCollapsed(collapsed) {
            isCollapsed = collapsed;
            localStorage.setItem('animatePanelCollapsed', collapsed ? 'true' : 'false');
            if (collapsed) {
                btnContainer.style.display = 'none';
                panel.style.width = '52px';
                panel.style.height = '52px';
                panel.style.minWidth = '52px';
                panel.style.minHeight = '52px';
                collapseIcon.textContent = 'chevron_right';

                // Сделаем панель почти невидимой в свернутом состоянии
                panel.style.opacity = '0.00';

                // Удаляем класс развернутой панели и добавляем класс свернутой
                panel.classList.remove('panel-expanded');
                panel.classList.add('panel-collapsed');
            } else {
                btnContainer.style.display = 'flex';
                panel.style.width = 'auto';
                panel.style.height = 'auto';
                panel.style.minWidth = '52px';
                panel.style.minHeight = '52px';
                collapseIcon.textContent = 'chevron_left';

                // Сделаем панель полностью видимой в развернутом состоянии
                panel.style.opacity = '1';

                // Удаляем класс свернутой панели и добавляем класс развернутой
                panel.classList.remove('panel-collapsed');
                panel.classList.add('panel-expanded');
            }
        }
        setPanelCollapsed(isCollapsed);

        // Добавляем события для отображения свернутой панели при наведении
        panel.addEventListener('mouseenter', () => {
            // Показываем панель при наведении только если она свернута
            if (isCollapsed) {
                panel.style.opacity = '1';
            }
        });

        panel.addEventListener('mouseleave', () => {
            // Скрываем панель при уходе курсора только если она свернута
            if (isCollapsed) {
                panel.style.opacity = '0.00';
            }
        });

        // Делаем плавный переход для opacity
        panel.style.transition = 'opacity 0.3s, width 0.2s, height 0.2s, background 0.2s';

        // === devicePixelRatio compensation ===
        function getUnzoomCompensated(val) {
            return Math.round(val);
        }

        // === Масштаб панели ===
        let panelScaleFactor = 1.0;
        const SCALE_MIN = 0.5;
        const SCALE_MAX = 2.0;
        const SCALE_STEP = 0.1;

        function savePanelScale() {
            localStorage.setItem('animatePanelScale', panelScaleFactor.toString());
        }

        // Загружаем сохраненный масштаб
        try {
            const savedScale = parseFloat(localStorage.getItem('animatePanelScale'));
            if (!isNaN(savedScale) && savedScale >= SCALE_MIN && savedScale <= SCALE_MAX) {
                panelScaleFactor = savedScale;
            }
        } catch (e) {
            console.warn('Ошибка при загрузке сохраненного масштаба:', e);
        }

        // Добавляем элемент для изменения размера
        const resizeHandle = document.createElement('div');
        Object.assign(resizeHandle.style, {
            position: 'absolute',
            right: '0',
            bottom: '0',
            width: '20px',
            height: '20px',
            cursor: 'nwse-resize',
            zIndex: '10003',
            background: 'transparent',
            opacity: '0.001', // Почти прозрачный, но реагирует на события
        });

        // Добавляем визуальный индикатор
        const resizeIcon = document.createElement('div');
        Object.assign(resizeIcon.style, {
            position: 'absolute',
            right: '4px',
            bottom: '4px',
            width: '12px',
            height: '12px',
            pointerEvents: 'none',
            borderRight: '2px solid rgba(255,255,255,0.5)',
            borderBottom: '2px solid rgba(255,255,255,0.5)',
            opacity: '0.7',
        });

        panel.appendChild(resizeHandle);
        panel.appendChild(resizeIcon);

        // Обработка перетаскивания для изменения масштаба
        let isResizing = false;
        let resizeStartX = 0;
        let resizeStartScale = 1.0;

        resizeHandle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartScale = panelScaleFactor;
            document.body.style.cursor = 'nwse-resize';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const dx = e.clientX - resizeStartX;
            const scaleDelta = dx * 0.005; // Коэффициент чувствительности
            const newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, resizeStartScale + scaleDelta));

            if (newScale !== panelScaleFactor) {
                panelScaleFactor = newScale;
                applyPanelScaleAndZoom();
                savePanelScale();
            }
        });

        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
            }
        });

        function applyPanelScaleAndZoom() {
            const zoom = (1 / window.devicePixelRatio) * panelScaleFactor;
            panel.style.transform = `scale(${zoom})`;
            panel.style.transformOrigin = 'top left';
        }
        applyPanelScaleAndZoom();

        function setPanelPosition(left, top) {
            // Получаем размеры окна браузера
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            // Получаем размеры панели
            const panelRect = panel.getBoundingClientRect();
            const panelWidth = panelRect.width / (1 / window.devicePixelRatio * panelScaleFactor);
            const panelHeight = panelRect.height / (1 / window.devicePixelRatio * panelScaleFactor);

            // Ограничиваем позицию панели границами окна браузера
            // Добавляем небольшой запас, чтобы панель не прилипала вплотную к краю
            const buffer = 5;

            // Ограничиваем левую и правую границы
            left = Math.max(buffer, Math.min(left, windowWidth - panelWidth - buffer));

            // Ограничиваем верхнюю и нижнюю границы
            // Учитываем наличие информационной панели внизу (24px)
            const bottomBarHeight = 24;
            top = Math.max(buffer, Math.min(top, windowHeight - panelHeight - bottomBarHeight - buffer));

            // Устанавливаем позицию
            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }
        setPanelPosition(16, 16);

        // При изменении devicePixelRatio пересчитать transform и позицию
        window.addEventListener('resize', () => {
            applyPanelScaleAndZoom();
            const rect = panel.getBoundingClientRect();

            // После изменения размера окна проверяем, не выходит ли панель за его пределы
            setPanelPosition(rect.left, rect.top);
        });

        // Обработчик колесика мыши для масштабирования
        panel.addEventListener('wheel', (e) => {
            if (!e.altKey) return; // Только при зажатом Alt

            e.preventDefault();
            const direction = e.deltaY < 0 ? 1 : -1;
            const oldScale = panelScaleFactor;
            panelScaleFactor = Math.max(SCALE_MIN, Math.min(SCALE_MAX, panelScaleFactor + direction * SCALE_STEP));

            if (oldScale !== panelScaleFactor) {
                const rect = panel.getBoundingClientRect();
                applyPanelScaleAndZoom();
                savePanelScale();
            }
        });

        // === Drag&Drop только за collapseBtn ===
        collapseBtn.style.cursor = 'move';
        let panelDragActive = false;
        let panelDragStartX = 0;
        let panelDragStartY = 0;
        let panelStartLeft = 16;
        let panelStartTop = 16;
        let panelDragMoved = false;
        collapseBtn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            panelDragActive = true;
            panelDragMoved = false;
            panelDragStartX = e.clientX;
            panelDragStartY = e.clientY;
            // panelStartLeft/Top в логических px
            const rect = panel.getBoundingClientRect();
            panelStartLeft = getUnzoomCompensated(rect.left);
            panelStartTop = getUnzoomCompensated(rect.top);
            panel.style.transition = 'none';
            document.body.style.cursor = 'move';
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!panelDragActive) return;
            const dx = e.clientX - panelDragStartX;
            const dy = e.clientY - panelDragStartY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panelDragMoved = true;
            setPanelPosition(panelStartLeft + dx, panelStartTop + dy);
        });
        window.addEventListener('mouseup', () => {
            if (panelDragActive) {
                panelDragActive = false;
                panel.style.transition = '';
                document.body.style.cursor = '';
            }
        });

        // === Кнопки линеек и ширины (макс. 2 в ряд) ===
        const scaleBox = document.createElement('div');
        Object.assign(scaleBox.style, {
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: '6px',
            zIndex: '10002',
            margin: '8px 0 0 0',
            justifyContent: 'center',
            alignItems: 'center',
            width: '100%'
        });

        const rulersBtn = document.createElement('button');
            rulersBtn.title = 'Показать/скрыть линейки и гайды\nКлик на свободное место — рисование прямоугольников (можно рисовать много подряд)\nПеретаскивание от линеек — создание гайдов';
        rulersBtn.innerHTML = '<span class="material-icons" style="font-size:28px;">straighten</span>';
        Object.assign(rulersBtn.style, {
            width: '44px', height: '44px',
            borderRadius: '8px',
            border: 'none',
            background: 'rgba(0,0,0,0.5)',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0',
            boxShadow: '0 2px 8px rgba(0,0,0,0.13)',
            transition: 'background 0.18s, box-shadow 0.18s',
            margin: '0 0 0 0',
            alignSelf: 'center',
        });

        // Состояние активности линеек
        window.isRulersActive = false;

        // Обновление цвета кнопки в зависимости от состояния
        function updateRulersBtnColor() {
            // Используем тот же зеленый цвет, что и для кнопки изменения ширины
            rulersBtn.style.background = window.isRulersActive ? 'rgba(0,180,0,0.5)' : 'rgba(0,0,0,0.5)';
        }

        rulersBtn.addEventListener('mouseenter', () => {
            rulersBtn.style.background = 'rgba(255,255,255,0.2)';
        });

        rulersBtn.addEventListener('mouseleave', () => {
            // При уходе мыши восстанавливаем цвет в зависимости от состояния
            updateRulersBtnColor();
        });

        rulersBtn.addEventListener('mousedown', () => {
            rulersBtn.style.background = 'rgba(255,255,255,0.32)';
        });

        rulersBtn.addEventListener('mouseup', () => {
            rulersBtn.style.background = 'rgba(255,255,255,0.2)';
        });

        // Вставляем кнопку rulersBtn в scaleBox
        scaleBox.appendChild(rulersBtn);

        // Добавляем кнопку управления шириной баннера
        console.log('[Banner Control] Панель: createWidthControlButton существует?', !!window.createWidthControlButton);
        if (window.createWidthControlButton) {
            window.createWidthControlButton(scaleBox);
        } else {
            console.warn('[Banner Control] Панель: createWidthControlButton не найдена, кнопка ширины не добавлена');
        }

        btnContainer.appendChild(scaleBox);

        // Показывать кнопки только если панель развернута
        function updateScaleBoxVisibility() {
            scaleBox.style.display = isCollapsed ? 'none' : 'flex';
        }
        updateScaleBoxVisibility();
        // Вызов при изменении состояния панели
        const origSetPanelCollapsed = setPanelCollapsed;
        setPanelCollapsed = function(collapsed) {
            origSetPanelCollapsed(collapsed);
            updateScaleBoxVisibility();
        };
        // Обработчик кнопки сворачивания
        collapseBtn.addEventListener('click', (e) => {
            if (panelDragMoved) {
                panelDragMoved = false;
                return;
            }
            setPanelCollapsed(!isCollapsed);
        });

        // === Контейнер для линеек и гайдов ===
        const rulersOverlay = document.createElement('div');
        Object.assign(rulersOverlay.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            width: '100vw',
            height: '100vh',
            pointerEvents: 'none',
            zIndex: '2147483646',
        });
        rulersOverlay.style.display = 'none';
        document.body.appendChild(rulersOverlay);

        // Горизонтальная линейка
        const rulerH = document.createElement('canvas');
        rulerH.width = window.innerWidth;
        rulerH.height = 24;
        Object.assign(rulerH.style, {
            position: 'absolute',
            left: '0',
            top: '0',
            width: '100vw',
            height: '24px',
            background: 'rgba(30,30,30,0.01)', // Еще более прозрачный фон
            pointerEvents: 'auto',
            userSelect: 'none',
            cursor: 'ns-resize', // Курсор для перетаскивания
            transition: 'background 0.2s', // Плавный переход при наведении
        });
        rulersOverlay.appendChild(rulerH);

        // Вертикальная линейка
        const rulerV = document.createElement('canvas');
        rulerV.width = 24;
        rulerV.height = window.innerHeight;
        Object.assign(rulerV.style, {
            position: 'absolute',
            left: '0',
            top: '0',
            width: '24px',
            height: '100vh',
            background: 'rgba(30,30,30,0.01)', // Еще более прозрачный фон
            pointerEvents: 'auto',
            userSelect: 'none',
            cursor: 'ew-resize', // Курсор для перетаскивания
            transition: 'background 0.2s', // Плавный переход при наведении
        });
        rulersOverlay.appendChild(rulerV);

        // Добавляем обработчики для изменения видимости линеек при наведении
        let isRulerHHovered = false;
        let isRulerVHovered = false;

        rulerH.addEventListener('mouseenter', () => {
            isRulerHHovered = true;
            rulerH.style.background = 'rgba(30,30,30,0.3)';
            drawRulers();
        });
        rulerH.addEventListener('mouseleave', () => {
            isRulerHHovered = false;
            rulerH.style.background = 'rgba(30,30,30,0.01)';
            drawRulers();
        });

        rulerV.addEventListener('mouseenter', () => {
            isRulerVHovered = true;
            rulerV.style.background = 'rgba(30,30,30,0.3)';
            drawRulers();
        });
        rulerV.addEventListener('mouseleave', () => {
            isRulerVHovered = false;
            rulerV.style.background = 'rgba(30,30,30,0.01)';
            drawRulers();
        });

        // Временные гайды при перетаскивании
        let tempGuide = null;
        let isDraggingNewGuide = false;
        let dragStartPos = 0;

        // Создание временного гайда
        function createTempGuide(isHorizontal) {
            const guide = document.createElement('div');
            Object.assign(guide.style, {
                position: 'fixed',
                background: 'rgba(255,200,0,0.7)',
                pointerEvents: 'none',
                zIndex: '2147483647',
                boxShadow: '0 0 8px 2px rgba(255,200,0,0.3)',
            });
            if (isHorizontal) {
                Object.assign(guide.style, {
                    left: '0',
                    width: '100vw',
                        height: '1px',
                });
            } else {
                Object.assign(guide.style, {
                    top: '0',
                        width: '1px',
                    height: '100vh',
                });
            }
            return guide;
        }

        // Обработчики для горизонтальной линейки
        rulerH.addEventListener('mousedown', (e) => {
            isDraggingNewGuide = true;
            dragStartPos = e.clientY;
            tempGuide = createTempGuide(true);
            tempGuide.style.top = dragStartPos + 'px';
            guidesContainer.appendChild(tempGuide);
            document.body.style.cursor = 'ns-resize';
        });

        // Обработчики для вертикальной линейки
        rulerV.addEventListener('mousedown', (e) => {
            isDraggingNewGuide = true;
            dragStartPos = e.clientX;
            tempGuide = createTempGuide(false);
            tempGuide.style.left = dragStartPos + 'px';
            guidesContainer.appendChild(tempGuide);
            document.body.style.cursor = 'ew-resize';
        });

        // Общие обработчики перемещения и отпускания
        window.addEventListener('mousemove', (e) => {
            if (!isDraggingNewGuide || !tempGuide) return;

                if (tempGuide.style.height === '1px') { // Горизонтальный гайд
                tempGuide.style.top = e.clientY + 'px';
            } else { // Вертикальный гайд
                tempGuide.style.left = e.clientX + 'px';
            }
        });

            // ОБЪЕДИНЕННЫЙ обработчик mouseup для всех операций
        window.addEventListener('mouseup', (e) => {
                // === СОЗДАНИЕ ГАЙДОВ ===
                if (isDraggingNewGuide && tempGuide) {
                    if (tempGuide.style.height === '1px') { // Горизонтальный гайд
                const y = e.clientY;
                if (y > 24) { // Убедимся, что гайд не создается в области линейки
                    hGuides.push(y);
                }
            } else { // Вертикальный гайд
                const x = e.clientX;
                if (x > 24) { // Убедимся, что гайд не создается в области линейки
                    vGuides.push(x);
                }
            }

            // Очистка
            if (tempGuide.parentNode) {
                tempGuide.parentNode.removeChild(tempGuide);
            }
            tempGuide = null;
            isDraggingNewGuide = false;
            document.body.style.cursor = '';

            saveGuides();
            renderGuides();
                    return; // Выходим, чтобы не выполнять другие обработчики
                }

                // === СОЗДАНИЕ ПРЯМОУГОЛЬНИКОВ ===
                if (drawingRect && drawingStart && drawingRectData) {
                    if (drawingRectData.width < 1 || drawingRectData.height < 1) {
                        if (drawingRect.parentNode) drawingRect.parentNode.removeChild(drawingRect);
                    } else {
                        drawnRects.push({ ...drawingRectData });
                        saveGuides();
                    }
                    if (drawingRect && drawingRect.parentNode) drawingRect.parentNode.removeChild(drawingRect);
                    drawingRect = null;
                    drawingStart = null;
                    drawingRectData = null;
                    renderGuides();

                    // Устанавливаем флаг недавно завершенного рисования
                    recentlyFinishedDrawing = true;
                    setTimeout(() => {
                        recentlyFinishedDrawing = false;
                    }, 300);

                    return; // Выходим, чтобы не выполнять другие обработчики
                }

                // === ИЗМЕНЕНИЕ РАЗМЕРА ПРЯМОУГОЛЬНИКОВ ===
                if (resizingRectIdx !== null) {
                    resizingRectIdx = null;
                    resizingHandle = null;
                    resizeStart = null;
                    return; // Выходим, чтобы не выполнять другие обработчики
                }

                // === ПЕРЕМЕЩЕНИЕ ГАЙДОВ ===
                if (draggingGuide) {
                    saveGuides();
                    draggingGuide = null;
                    dragType = null;
                    dragIndex = -1;
                    document.body.style.cursor = '';
                    return; // Выходим
                }
        });

        // Удаляем старые обработчики клика по линейкам
        rulerH.removeEventListener('click', null);
        rulerV.removeEventListener('click', null);

        // === Гайды ===
        let hGuides = [];
        let vGuides = [];
        // === Прямоугольники ===
        let drawnRects = [];
        let drawingRect = null;
        let drawingStart = null;
        let drawingRectData = null;

        // === Resize state ===
        let resizingRectIdx = null;
        let resizingHandle = null;
        let resizeStart = null;
        // === Move state ===
        let movingRectIdx = null;
        let moveStart = null;
        let moveOrig = null;
        // Восстановление из localStorage
        try {
            const saved = JSON.parse(localStorage.getItem('animatePanelGuides') || '{}');
            if (Array.isArray(saved.h)) hGuides = saved.h;
            if (Array.isArray(saved.v)) vGuides = saved.v;
            if (Array.isArray(saved.rects)) drawnRects = saved.rects;
        } catch {}
        // Контейнер для div-гайдов
        const guidesContainer = document.createElement('div');
        Object.assign(guidesContainer.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            width: '100vw',
            height: '100vh',
                pointerEvents: 'none', // По умолчанию не перехватываем события
            zIndex: '2147483647',
        });
        guidesContainer.style.display = 'none';
        document.body.appendChild(guidesContainer);

            // Создаем специальный слой для перехвата событий рисования
            const drawingLayer = document.createElement('div');
            Object.assign(drawingLayer.style, {
                position: 'fixed',
                left: '0',
                top: '0',
                width: '100vw',
                height: '100vh',
                pointerEvents: 'auto',
                zIndex: '2147483640', // Ниже чем другие UI элементы
                background: 'transparent',
            });
            drawingLayer.style.display = 'none';
            document.body.appendChild(drawingLayer);

        // Сохранение
        function saveGuides() {
            localStorage.setItem('animatePanelGuides', JSON.stringify({
                h: hGuides,
                v: vGuides,
                rects: drawnRects
            }));
        }

                // === Рисование прямоугольников мышкой ===
                // Фиксированный цвет для прямоугольников
                const RECTANGLE_COLOR = 'rgba(0, 120, 255, 0.25)';

                // Функция для проверки, близко ли клик к существующим гайдам
                function isNearGuide(x, y, threshold = 5) {
                    // Проверяем близость к вертикальным гайдам
                    for (let guideX of vGuides) {
                        if (Math.abs(x - guideX) <= threshold) {
                            return true;
                        }
                    }

                    // Проверяем близость к горизонтальным гайдам
                    for (let guideY of hGuides) {
                        if (Math.abs(y - guideY) <= threshold) {
                            return true;
                        }
                    }

                    return false;
                }

                // Функция для проверки, находится ли клик рядом с прямоугольником
                function isNearRectangleEdge(x, y, threshold = 4) {
                    for (let rect of drawnRects) {
                        const left = rect.left;
                        const right = rect.left + rect.width;
                        const top = rect.top;
                        const bottom = rect.top + rect.height;

                        if ((Math.abs(x - left) <= threshold || Math.abs(x - right) <= threshold) &&
                            y >= top - threshold && y <= bottom + threshold) {
                            return true;
                        }

                        if ((Math.abs(y - top) <= threshold || Math.abs(y - bottom) <= threshold) &&
                            x >= left - threshold && x <= right + threshold) {
                            return true;
                        }
                    }
                    return false;
                }

                // Функция для проверки, находится ли клик в области линеек
                function isInRulerArea(x, y) {
                    return x <= 24 || y <= 24;
                }

                // Функция для проверки, находится ли клик в области панели управления
                function isInPanelArea(x, y) {
                    try {
                        const panelRect = panel.getBoundingClientRect();
                        const inPanel = x >= panelRect.left && x <= panelRect.right &&
                                       y >= panelRect.top && y <= panelRect.bottom;
                        if (inPanel) {
                            console.log(`[Drawing] Клик в области панели: панель (${panelRect.left}, ${panelRect.top}, ${panelRect.right}, ${panelRect.bottom}), клик (${x}, ${y})`);
                        }
                        return inPanel;
                    } catch (e) {
                        return false;
                    }
                }

                // Улучшенная логика обработки кликов в области линеек и гайдов
                drawingLayer.addEventListener('mousedown', (e) => {
                if (rulersOverlay.style.display === 'none') return;
                if (e.button !== 0) return;

                    const clickX = e.clientX;
                    const clickY = e.clientY;

                    console.log(`[Drawing] Клик в позиции: ${clickX}, ${clickY}`);
                    console.log(`[Drawing] Состояние drawingLayer - display: ${drawingLayer.style.display}, pointer-events: ${drawingLayer.style.pointerEvents}`);

                    // Если клик в области линеек, не рисуем прямоугольник
                    if (isInRulerArea(clickX, clickY)) {
                        console.log('[Drawing] Клик в области линеек - отмена рисования');
                        return;
                    }

                    // Если клик в области панели управления, передаем событие панели
                    if (isInPanelArea(clickX, clickY)) {
                        console.log('[Drawing] Клик в области UI - проксирование события');
                        // Временно отключаем pointer-events у drawingLayer
                        drawingLayer.style.pointerEvents = 'none';
                        // Получаем элемент под курсором
                        const elementUnder = document.elementFromPoint(clickX, clickY);
                        // Восстанавливаем pointer-events
                        drawingLayer.style.pointerEvents = 'auto';

                        // Если есть элемент под курсором, отправляем ему событие
                        if (elementUnder) {
                            // Для интерактивных элементов используем нативные события
                            if (isInteractiveUIElement(elementUnder)) {
                                // Полностью отключаем drawingLayer для интерактивных элементов
                                drawingLayer.style.pointerEvents = 'none';

                                // Создаем новое событие с правильными параметрами
                                const newEvent = new MouseEvent('mousedown', {
                                    bubbles: true,
                                    cancelable: true,
                                    clientX: clickX,
                                    clientY: clickY,
                                    button: e.button,
                                    buttons: e.buttons,
                                    which: e.which
                                });

                                // Фокусируем элемент перед отправкой события
                                if (elementUnder.focus) {
                                    elementUnder.focus();
                                }

                                elementUnder.dispatchEvent(newEvent);

                                // Восстанавливаем pointer-events через короткое время
                                setTimeout(() => {
                                    drawingLayer.style.pointerEvents = 'auto';
                                }, 200);
                            } else {
                                const newEvent = new MouseEvent('mousedown', {
                                    bubbles: true,
                                    cancelable: true,
                                    clientX: clickX,
                                    clientY: clickY,
                                    button: e.button,
                                    buttons: e.buttons
                                });
                                elementUnder.dispatchEvent(newEvent);
                            }
                        }
                        return;
                    }

                    // Если клик рядом с существующим гайдом, не рисуем прямоугольник
                    if (isNearGuide(clickX, clickY)) {
                        console.log('[Drawing] Клик рядом с гайдом - отмена рисования');
                        return;
                    }

                    // Если клик рядом с углом прямоугольника, не рисуем прямоугольник
                    if (isNearRectangleEdge(clickX, clickY)) {
                        console.log('[Drawing] Клик рядом с прямоугольником - отмена рисования');
                        return;
                    }

                    // Рисование прямоугольника
                    console.log('[Drawing] Начинаем рисование прямоугольника');
                        drawingStart = { x: clickX, y: clickY };
                        drawingRectData = { left: drawingStart.x, top: drawingStart.y, width: 1, height: 1, color: RECTANGLE_COLOR };
                        drawingRect = document.createElement('div');
                Object.assign(drawingRect.style, {
                    position: 'fixed',
                    left: `${drawingRectData.left}px`,
                    top: `${drawingRectData.top}px`,
                    width: `${drawingRectData.width}px`,
                    height: `${drawingRectData.height}px`,
                    border: `1px solid #2196f3`,
                    background: drawingRectData.color,
                    zIndex: '2147483648',
                    pointerEvents: 'none',
                    borderRadius: '0px',
                    boxSizing: 'border-box',
                    cursor: 'crosshair',
                    overflow: 'visible'
                    });

                    // Создаем текстовую метку с размерами для временного прямоугольника
                    const drawingSizeLabel = document.createElement('div');
                    drawingSizeLabel.textContent = `${Math.round(drawingRectData.width)}×${Math.round(drawingRectData.height)}`;

                // Функция для обновления размера и позиции метки
                function updateDrawingSizeLabel() {
                    const width = drawingRectData.width;
                    const height = drawingRectData.height;
                    const minSize = Math.min(width, height);

                    // Масштабируем размер шрифта в зависимости от размера прямоугольника
                    const fontSize = Math.max(8, Math.min(16, minSize / 8));
                    const padding = Math.max(1, Math.min(4, minSize / 20));

                    Object.assign(drawingSizeLabel.style, {
                        position: 'absolute',
                        left: '0',
                        top: '100%',
                        fontSize: `${fontSize}px`,
                        fontWeight: 'bold',
                        color: '#2196f3',
                        background: 'rgba(255, 255, 255, 0.95)',
                        padding: `${padding}px ${padding * 2}px`,
                        borderRadius: '3px',
                        border: '1px solid #2196f3',
                        pointerEvents: 'none',
                        userSelect: 'none',
                        fontFamily: 'Arial, sans-serif',
                        lineHeight: '1',
                        whiteSpace: 'nowrap',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        zIndex: '2147483649',
                        transform: 'translateY(2px)'
                    });
                }

                        updateDrawingSizeLabel();
                        drawingRect.appendChild(drawingSizeLabel);
                        guidesContainer.appendChild(drawingRect);
                    console.log('[Drawing] Прямоугольник успешно создан и добавлен в DOM');
                    e.preventDefault();
                    e.stopPropagation(); // Останавливаем всплытие события
            });

            window.addEventListener('mousemove', (e) => {
                // Обновление прямоугольника при рисовании
                if (drawingRect && drawingStart && drawingRectData) {
                    const x1 = drawingStart.x;
                    const y1 = drawingStart.y;
                    const x2 = e.clientX;
                    const y2 = e.clientY;
                    const left = Math.min(x1, x2);
                    const top = Math.min(y1, y2);
                    const width = Math.abs(x2 - x1);
                    const height = Math.abs(y2 - y1);
                    Object.assign(drawingRect.style, {
                        left: `${left}px`,
                        top: `${top}px`,
                        width: `${width}px`,
                        height: `${height}px`,
                    });
                    drawingRectData.left = left;
                    drawingRectData.top = top;
                    drawingRectData.width = width;
                    drawingRectData.height = height;

                    // Обновляем текст размеров в реальном времени
                    const sizeLabel = drawingRect.querySelector('div');
                    if (sizeLabel) {
                        sizeLabel.textContent = `${Math.round(width)}×${Math.round(height)}`;

                        // Обновляем размер и позицию метки
                        const minSize = Math.min(width, height);
                        const fontSize = Math.max(8, Math.min(16, minSize / 8));
                        const padding = Math.max(1, Math.min(4, minSize / 20));

                        sizeLabel.style.fontSize = `${fontSize}px`;
                        sizeLabel.style.padding = `${padding}px ${padding * 2}px`;
                    }
                }
            });

                // Улучшенное проксирование событий click для UI элементов
                drawingLayer.addEventListener('click', (e) => {
                    if (rulersOverlay.style.display === 'none') return;

                    const clickX = e.clientX;
                    const clickY = e.clientY;

                    console.log('[Drawing Debug v1.42] 👆 CLICK в drawingLayer:', clickX, clickY);

                    // Если клик в области панели управления, проксируем событие
                    if (isInPanelArea(clickX, clickY)) {
                        console.log('[Drawing Debug v1.42] 🔄 Проксирование клика в UI область');
                        // Временно отключаем pointer-events у drawingLayer
                        drawingLayer.style.pointerEvents = 'none';
                        // Получаем элемент под курсором
                        const elementUnder = document.elementFromPoint(clickX, clickY);
                        // Восстанавливаем pointer-events
                        drawingLayer.style.pointerEvents = 'auto';

                        // Если есть элемент под курсором, отправляем ему событие
                        if (elementUnder) {
                            // Для интерактивных элементов используем более точное проксирование
                            if (isInteractiveUIElement(elementUnder)) {
                                elementUnder.focus();
                                elementUnder.click();
                            } else {
                                const newEvent = new MouseEvent('click', {
                                    bubbles: true,
                                    cancelable: true,
                                    clientX: clickX,
                                    clientY: clickY,
                                    button: e.button,
                                    buttons: e.buttons
                                });
                                elementUnder.dispatchEvent(newEvent);
                            }
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }

                    // Если дошли до сюда - клик НЕ в UI области
                                            console.log('[Drawing Debug v1.42] ✅ Клик НЕ в UI области - не блокируем');
                });

                // Добавляем проксирование событий mouseup для UI элементов
                drawingLayer.addEventListener('mouseup', (e) => {
                    if (rulersOverlay.style.display === 'none') return;

                    const clickX = e.clientX;
                    const clickY = e.clientY;

                    // Если mouseup в области панели управления, проксируем событие
                    if (isInPanelArea(clickX, clickY)) {
                        // Временно отключаем pointer-events у drawingLayer
                        drawingLayer.style.pointerEvents = 'none';
                        // Получаем элемент под курсором
                        const elementUnder = document.elementFromPoint(clickX, clickY);
                        // Восстанавливаем pointer-events
                        drawingLayer.style.pointerEvents = 'auto';
                        // Если есть элемент под курсором, отправляем ему событие
                        if (elementUnder) {
                            const newEvent = new MouseEvent('mouseup', {
                                bubbles: true,
                                cancelable: true,
                                clientX: clickX,
                                clientY: clickY,
                                button: e.button,
                                buttons: e.buttons
                            });
                            elementUnder.dispatchEvent(newEvent);
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                });

                // Улучшенное проксирование событий для UI элементов
                let lastHoveredElement = null;
                let isMouseOverUI = false;
                let cursorChangeTimeout = null;

                // Функция для проверки, является ли элемент интерактивным UI элементом
                function isInteractiveUIElement(element) {
                    if (!element) return false;

                    const tagName = element.tagName.toLowerCase();

                    // Проверяем различные типы интерактивных элементов
                    const isButton = tagName === 'button';
                    const isInput = tagName === 'input';
                    const isSelect = tagName === 'select';
                    const isTextarea = tagName === 'textarea';
                    const isContentEditable = element.contentEditable === 'true';
                    const hasFrameSliderClass = element.classList.contains('frame-slider');

                    // Особая проверка для range input (слайдеров)
                    const isRangeSlider = isInput && element.type === 'range';

                    // Проверяем родительские элементы слайдера (только для реальных UI элементов)
                    const isSliderContainer = element.closest && (
                        element.closest('.frame-slider') ||
                        element.closest('input[type="range"]')
                    );

                    return (
                        isButton ||
                        isInput ||
                        isSelect ||
                        isTextarea ||
                        isContentEditable ||
                        hasFrameSliderClass ||
                        isRangeSlider ||
                        isSliderContainer
                    );
                }

                // Функция для стабильного изменения курсора
                let lastSetCursor = '';
                function setStableCursor(cursor) {
                    // Не меняем курсор если он уже установлен
                    if (lastSetCursor === cursor) {
                        return;
                    }

                    if (cursorChangeTimeout) {
                        clearTimeout(cursorChangeTimeout);
                    }

                    // Проверяем, что drawingLayer видим и доступен
                    if (drawingLayer.style.display !== 'none' && drawingLayer.style.pointerEvents !== 'none') {
                        drawingLayer.style.cursor = cursor;
                        lastSetCursor = cursor;
                    }

                    // Предотвращаем быстрые изменения курсора
                    cursorChangeTimeout = setTimeout(() => {
                        cursorChangeTimeout = null;
                    }, 100);
                }

                drawingLayer.addEventListener('mousemove', (e) => {
                    if (rulersOverlay.style.display === 'none') return;

                    const mouseX = e.clientX;
                    const mouseY = e.clientY;

                    // Проверяем, находится ли курсор в области UI
                    const inUIArea = isInPanelArea(mouseX, mouseY);

                    if (inUIArea) {
                        // Временно отключаем pointer-events у drawingLayer
                        drawingLayer.style.pointerEvents = 'none';
                        // Получаем элемент под курсором
                        const elementUnder = document.elementFromPoint(mouseX, mouseY);
                        // Восстанавливаем pointer-events
                        drawingLayer.style.pointerEvents = 'auto';

                        // Если это интерактивный элемент, отключаем перехват
                        if (isInteractiveUIElement(elementUnder)) {
                            isMouseOverUI = true;
                            // НЕ отключаем pointer-events здесь постоянно, только при взаимодействии
                            setStableCursor('default');
                            return;
                        }

                        isMouseOverUI = false;

                        // Обычное проксирование для неинтерактивных элементов
                        if (elementUnder !== lastHoveredElement) {
                            // Отправляем mouseleave предыдущему элементу
                            if (lastHoveredElement) {
                                const leaveEvent = new MouseEvent('mouseleave', {
                                    bubbles: true,
                                    cancelable: true,
                                    clientX: mouseX,
                                    clientY: mouseY
                                });
                                lastHoveredElement.dispatchEvent(leaveEvent);
                            }

                            // Отправляем mouseenter новому элементу
                            if (elementUnder) {
                                const enterEvent = new MouseEvent('mouseenter', {
                                    bubbles: true,
                                    cancelable: true,
                                    clientX: mouseX,
                                    clientY: mouseY
                                });
                                elementUnder.dispatchEvent(enterEvent);
                            }

                            lastHoveredElement = elementUnder;
                        }

                        // Всегда отправляем mousemove элементу под курсором
                        if (elementUnder) {
                            const moveEvent = new MouseEvent('mousemove', {
                                bubbles: true,
                                cancelable: true,
                                clientX: mouseX,
                                clientY: mouseY
                            });
                            elementUnder.dispatchEvent(moveEvent);
                        }

                        // Устанавливаем обычный курсор для UI элементов
                        setStableCursor('default');
                    } else {
                        // Курсор в области рисования
                        isMouseOverUI = false;

                        // Убеждаемся что pointer-events включены для области рисования
                        if (drawingLayer.style.pointerEvents === 'none') {
                            drawingLayer.style.pointerEvents = 'auto';
                        }

                        // Если курсор вышел из области UI, отправляем mouseleave последнему элементу
                        if (lastHoveredElement) {
                            const leaveEvent = new MouseEvent('mouseleave', {
                                bubbles: true,
                                cancelable: true,
                                clientX: mouseX,
                                clientY: mouseY
                            });
                            lastHoveredElement.dispatchEvent(leaveEvent);
                            lastHoveredElement = null;
                        }

                        // Определяем правильный курсор для области рисования
                        let newCursor = 'default';

                        if (isInRulerArea(mouseX, mouseY)) {
                            newCursor = mouseX <= 24 ? 'ew-resize' : 'ns-resize';
                        } else if (isNearGuide(mouseX, mouseY)) {
                            // Определяем тип ближайшего гайда для курсора
                            let nearVertical = false;
                            for (let guideX of vGuides) {
                                if (Math.abs(mouseX - guideX) <= 5) {
                                    nearVertical = true;
                                    break;
                                }
                            }
                            newCursor = nearVertical ? 'ew-resize' : 'ns-resize';
                        } else if (isNearRectangleEdge(mouseX, mouseY)) {
                            newCursor = 'move';
                        } else if (!isDraggingNewGuide && !draggingGuide && !drawingRect && resizingRectIdx === null) {
                            newCursor = 'crosshair'; // Курсор для прямоугольника
                        }

                        setStableCursor(newCursor);
                    }
                });

                // Дополнительные обработчики для надежного восстановления pointer-events
                drawingLayer.addEventListener('mouseleave', () => {
                    isMouseOverUI = false;
                    drawingLayer.style.pointerEvents = 'auto';
                    lastHoveredElement = null;
                });

                // Обрабатываем mouseup для создания прямоугольника
                const origWindowMouseUp = window.onmouseup;
                // Удаляем дублирующий обработчик - теперь обрабатывается в объединенном обработчике mouseup

        // === Функция для добавления маркеров изменения размера к прямоугольнику ===
        function addResizeHandles(r, idx) {
            const rect = drawnRects[idx];
            const minSize = Math.min(rect.width, rect.height);

            // Масштабируем размер ручек в зависимости от размера прямоугольника
            // Для очень маленьких квадратов делаем ручки еще меньше
            let handleSize;
            if (minSize <= 4) {
                handleSize = 2; // Минимальный размер для очень маленьких квадратов
            } else if (minSize <= 8) {
                handleSize = 3; // Средний размер для маленьких квадратов
            } else {
                handleSize = Math.max(4, Math.min(12, minSize / 8)); // Обычное масштабирование
            }

            const handleOffset = handleSize / 2;

            const handles = [
                { pos: 'nw', style: { left: `-${handleOffset}px`, top: `-${handleOffset}px`, cursor: 'nwse-resize' } },
                { pos: 'n', style: { left: `calc(50% - ${handleOffset}px)`, top: `-${handleOffset}px`, cursor: 'ns-resize' } },
                { pos: 'ne', style: { right: `-${handleOffset}px`, top: `-${handleOffset}px`, cursor: 'nesw-resize' } },
                { pos: 'e', style: { right: `-${handleOffset}px`, top: `calc(50% - ${handleOffset}px)`, cursor: 'ew-resize' } },
                { pos: 'se', style: { right: `-${handleOffset}px`, bottom: `-${handleOffset}px`, cursor: 'nwse-resize' } },
                { pos: 's', style: { left: `calc(50% - ${handleOffset}px)`, bottom: `-${handleOffset}px`, cursor: 'ns-resize' } },
                { pos: 'sw', style: { left: `-${handleOffset}px`, bottom: `-${handleOffset}px`, cursor: 'nesw-resize' } },
                { pos: 'w', style: { left: `-${handleOffset}px`, top: `calc(50% - ${handleOffset}px)`, cursor: 'ew-resize' } }
            ];

            handles.forEach(h => {
                const handle = document.createElement('div');

                // Специальная обработка для очень маленьких квадратов
                let handleStyle = { ...h.style };
                if (minSize <= 4) {
                    // Для очень маленьких квадратов размещаем ручки внутри границ
                    if (h.pos === 'nw') {
                        handleStyle = { left: '0px', top: '0px', cursor: 'nwse-resize' };
                    } else if (h.pos === 'ne') {
                        handleStyle = { right: '0px', top: '0px', cursor: 'nesw-resize' };
                    } else if (h.pos === 'se') {
                        handleStyle = { right: '0px', bottom: '0px', cursor: 'nwse-resize' };
                    } else if (h.pos === 'sw') {
                        handleStyle = { left: '0px', bottom: '0px', cursor: 'nesw-resize' };
                    } else if (h.pos === 'n') {
                        handleStyle = { left: 'calc(50% - 1px)', top: '0px', cursor: 'ns-resize' };
                    } else if (h.pos === 's') {
                        handleStyle = { left: 'calc(50% - 1px)', bottom: '0px', cursor: 'ns-resize' };
                    } else if (h.pos === 'e') {
                        handleStyle = { right: '0px', top: 'calc(50% - 1px)', cursor: 'ew-resize' };
                    } else if (h.pos === 'w') {
                        handleStyle = { left: '0px', top: 'calc(50% - 1px)', cursor: 'ew-resize' };
                    }
                }

                Object.assign(handle.style, {
                    position: 'absolute',
                    width: `${handleSize}px`,
                    height: `${handleSize}px`,
                    background: '#2196f3',
                    border: '1px solid #fff',
                    borderRadius: '0px',
                    zIndex: '2147483649',
                    pointerEvents: 'auto',
                    opacity: '0.8',
                    visibility: 'hidden',
                    ...handleStyle
                });

                handle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    resizingRectIdx = idx;
                    resizingHandle = h.pos;
                    const rect = drawnRects[idx];

                    resizeStart = {
                        startX: e.clientX,
                        startY: e.clientY,
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height
                    };
                });

                r.appendChild(handle);
            });

            // Показывать ручки при наведении
            r.addEventListener('mouseenter', () => {
                r.querySelectorAll('div').forEach(handle => {
                    handle.style.visibility = 'visible';
                });
            });

            // Скрывать ручки при уходе курсора
            r.addEventListener('mouseleave', () => {
                // Не скрываем ручки если этот прямоугольник изменяется
                if (resizingRectIdx === idx) return;

                r.querySelectorAll('div').forEach(handle => {
                    handle.style.visibility = 'hidden';
                });
            });
        }

        // Обновляем функцию renderGuides для создания прямоугольников с расширенной функциональностью
        function renderGuides() {
            guidesContainer.innerHTML = '';
            // Вертикальные
            vGuides.forEach((x, i) => {
                const g = document.createElement('div');
                Object.assign(g.style, {
                    position: 'fixed',
                    left: (x - 5) + 'px',  // Смещаем влево на 5px для увеличения области клика
                    top: '0',
                    width: '10px',  // Увеличенная ширина для удобства клика
                    height: '100vh',
                    background: 'transparent',  // Делаем фон прозрачным
                    zIndex: '2147483647',
                    cursor: 'ew-resize',
                    pointerEvents: 'auto',
                    userSelect: 'none',
                    boxShadow: selectedGuides.v.includes(i) ? '0 0 8px 2px #ffd70099' : '',
                });

                // Добавляем внутреннюю линию для визуального отображения
                const innerLine = document.createElement('div');
                Object.assign(innerLine.style, {
                    position: 'absolute',
                        left: '4.5px',  // Центрируем 1px линию в 10px контейнере
                    top: '0',
                        width: '1px',  // Уменьшенная ширина линии
                    height: '100%',
                    background: selectedGuides.v.includes(i) ? 'rgba(255,200,0,0.95)' : 'rgba(0,200,255,0.7)',
                    pointerEvents: 'none',  // Линия не мешает кликам
                    boxShadow: selectedGuides.v.includes(i) ? '0 0 8px 2px #ffd70099' : '',
                });
                g.appendChild(innerLine);

                g.title = 'Перетащите для перемещения, двойной клик — удалить, клик — выбрать для измерения';
                g.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    draggingGuide = g;
                    dragType = 'v';
                    dragIndex = i;
                    dragStart = e.clientX;
                    dragOrig = x;
                    document.body.style.cursor = 'ew-resize';
                    e.preventDefault();
                });
                g.addEventListener('dblclick', (e) => {
                    vGuides.splice(i, 1);
                    saveGuides();
                    renderGuides();
                    clearDistanceLabel();
                    e.stopPropagation();
                });
                g.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (selectedGuides.v.length === 0) {
                        selectedGuides.v = [i];
                        renderGuides();
                    } else if (selectedGuides.v.length === 1 && selectedGuides.v[0] !== i) {
                        selectedGuides.v.push(i);
                        renderGuides();
                        showDistanceLabel('v', selectedGuides.v[0], selectedGuides.v[1]);
                    } else {
                        clearDistanceLabel();
                        renderGuides();
                    }
                });
                guidesContainer.appendChild(g);
            });
            // Горизонтальные
            hGuides.forEach((y, i) => {
                const g = document.createElement('div');
                Object.assign(g.style, {
                    position: 'fixed',
                    left: '0',
                    top: (y - 5) + 'px',  // Смещаем вверх на 5px для увеличения области клика
                    width: '100vw',  // Увеличенная высота для удобства клика
                    height: '10px',  // Увеличенная высота для удобства клика
                    background: 'transparent',  // Делаем фон прозрачным
                    zIndex: '2147483647',
                    cursor: 'ns-resize',
                    pointerEvents: 'auto',
                    userSelect: 'none',
                    boxShadow: selectedGuides.h.includes(i) ? '0 0 8px 2px #ffd70099' : '',
                });

                // Добавляем внутреннюю линию для визуального отображения
                const innerLine = document.createElement('div');
                Object.assign(innerLine.style, {
                    position: 'absolute',
                    left: '0',
                        top: '4.5px',  // Центрируем 1px линию в 10px контейнере
                    width: '100%',
                        height: '1px',  // Уменьшенная высота линии
                    background: selectedGuides.h.includes(i) ? 'rgba(255,200,0,0.95)' : 'rgba(0,200,255,0.7)',
                    pointerEvents: 'none',  // Линия не мешает кликам
                    boxShadow: selectedGuides.h.includes(i) ? '0 0 8px 2px #ffd70099' : '',
                });
                g.appendChild(innerLine);

                g.title = 'Перетащите для перемещения, двойной клик — удалить, клик — выбрать для измерения';
                g.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    draggingGuide = g;
                    dragType = 'h';
                    dragIndex = i;
                    dragStart = e.clientY;
                    dragOrig = y;
                    document.body.style.cursor = 'ns-resize';
                    e.preventDefault();
                });
                g.addEventListener('dblclick', (e) => {
                    hGuides.splice(i, 1);
                    saveGuides();
                    renderGuides();
                    clearDistanceLabel();
                    e.stopPropagation();
                });
                g.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (selectedGuides.h.length === 0) {
                        selectedGuides.h = [i];
                        renderGuides();
                    } else if (selectedGuides.h.length === 1 && selectedGuides.h[0] !== i) {
                        selectedGuides.h.push(i);
                        renderGuides();
                        showDistanceLabel('h', selectedGuides.h[0], selectedGuides.h[1]);
                    } else {
                        clearDistanceLabel();
                        renderGuides();
                    }
                });
                guidesContainer.appendChild(g);
            });

            // Прямоугольники
            drawnRects.forEach((rect, idx) => {
                const r = document.createElement('div');
                Object.assign(r.style, {
                    position: 'fixed',
                    left: rect.left + 'px',
                    top: rect.top + 'px',
                    width: rect.width + 'px',
                    height: rect.height + 'px',
                    border: '1px solid #2196f3',
                    background: rect.color,
                    zIndex: '2147483648',
                    pointerEvents: 'auto',
                    borderRadius: '0px',
                    boxSizing: 'border-box',
                    outline: (resizingRectIdx === idx) ? '1px solid rgba(33, 150, 243, 0.5)' : (movingRectIdx === idx ? '1px solid rgba(255, 152, 0, 0.5)' : 'none'),
                    userSelect: 'none',
                    overflow: 'visible',
                    cursor: 'grab'
                    });

                    // Создаем текстовую метку с размерами
                    const sizeLabel = document.createElement('div');
                    sizeLabel.textContent = `${Math.round(rect.width)}×${Math.round(rect.height)}`;

                    // Масштабируем размер шрифта в зависимости от размера прямоугольника
                    const minSize = Math.min(rect.width, rect.height);
                    const fontSize = Math.max(8, Math.min(16, minSize / 8));
                    const padding = Math.max(1, Math.min(4, minSize / 20));

                    Object.assign(sizeLabel.style, {
                        position: 'absolute',
                        left: '0',
                        top: '100%',
                        fontSize: `${fontSize}px`,
                        fontWeight: 'bold',
                        color: '#2196f3',
                        background: 'rgba(255, 255, 255, 0.95)',
                        padding: `${padding}px ${padding * 2}px`,
                        borderRadius: '3px',
                        border: '1px solid #2196f3',
                        pointerEvents: 'none',
                        userSelect: 'none',
                        fontFamily: 'Arial, sans-serif',
                        lineHeight: '1',
                        whiteSpace: 'nowrap',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        zIndex: '2147483649',
                        transform: 'translateY(2px)'
                    });

                    // Добавляем метку в прямоугольник
                    r.appendChild(sizeLabel);

                // Удаление по двойному клику
                r.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    drawnRects.splice(idx, 1);
                    renderGuides();
                });

                // Перемещение прямоугольника только для копирования с Shift
                r.addEventListener('mousedown', (e) => {
                    // Если клик не на самом прямоугольнике (например, на маркере), игнорируем
                    if (e.target !== r) return;

                    // Если Shift зажат - копируем прямоугольник
                    if (e.shiftKey) {
                        e.stopPropagation();
                        const newRect = { ...rect };
                        newRect.left += 20;
                        newRect.top += 20;
                        drawnRects.push(newRect);
                        renderGuides();
                        return;
                    }

                    // Стандартное перемещение теперь обрабатывается через makeRectDraggable
                });

                // Добавляем маркеры для изменения размера
                addResizeHandles(r, idx);

                // Добавляем возможность перетаскивания через makeRectDraggable
                makeRectDraggable(r, idx);

                guidesContainer.appendChild(r);
            });

            // Метки расстояния и временные элементы
            if (distanceLabel) guidesContainer.appendChild(distanceLabel);
            if (drawingRect && drawingRect.parentNode == null) {
                guidesContainer.appendChild(drawingRect);
            }
        }

        // Переменная для отслеживания недавно завершенного рисования
        let recentlyFinishedDrawing = false;
        let guidesClickHandler = null;

        // Функция обработчика кликов в guidesContainer
        function createGuidesClickHandler() {
            return (e) => {
                // НЕ вмешиваемся в процесс рисования прямоугольников
                if (drawingRect) {
                    console.log('[Drawing Debug v1.42] 🚫 Клик в guidesContainer заблокирован - идет рисование');
                    return;
                }

                // НЕ вмешиваемся если недавно завершили рисование (в течение 300мс)
                if (recentlyFinishedDrawing) {
                    console.log('[Drawing Debug v1.42] 🚫 Клик в guidesContainer заблокирован - недавно завершили рисование');
                    return;
                }

                console.log('[Drawing Debug v1.42] 🎯 Клик в guidesContainer - сброс выбора');
                clearDistanceLabel();
                renderGuides();
            };
        }

        // Создаем и добавляем обработчик
        guidesClickHandler = createGuidesClickHandler();
        guidesContainer.addEventListener('click', guidesClickHandler);
        window.addEventListener('mousemove', (e) => {
            // === RESIZE RECT ===
            if (resizingRectIdx !== null && resizingHandle !== null && resizeStart) {
                const rect = drawnRects[resizingRectIdx];
                let dx = e.clientX - resizeStart.startX;
                let dy = e.clientY - resizeStart.startY;
                let newRect = Object.assign({}, rect);
                if (resizingHandle === 'nw') {
                    newRect.left = resizeStart.left + dx;
                    newRect.top = resizeStart.top + dy;
                    newRect.width = resizeStart.width - dx;
                    newRect.height = resizeStart.height - dy;
                } else if (resizingHandle === 'ne') {
                    newRect.top = resizeStart.top + dy;
                    newRect.width = resizeStart.width + dx;
                    newRect.height = resizeStart.height - dy;
                } else if (resizingHandle === 'sw') {
                    newRect.left = resizeStart.left + dx;
                    newRect.width = resizeStart.width - dx;
                    newRect.height = resizeStart.height + dy;
                } else if (resizingHandle === 'se') {
                    newRect.width = resizeStart.width + dx;
                    newRect.height = resizeStart.height + dy;
                } else if (resizingHandle === 'n') {
                    newRect.top = resizeStart.top + dy;
                    newRect.height = resizeStart.height - dy;
                } else if (resizingHandle === 'e') {
                    newRect.width = resizeStart.width + dx;
                } else if (resizingHandle === 's') {
                    newRect.height = resizeStart.height + dy;
                } else if (resizingHandle === 'w') {
                    newRect.left = resizeStart.left + dx;
                    newRect.width = resizeStart.width - dx;
                }
                // Минимальный размер
                if (newRect.width < 1) newRect.width = 1;
                if (newRect.height < 1) newRect.height = 1;
                drawnRects[resizingRectIdx] = newRect;
                renderGuides();
                return;
            }
            // === DRAG GUIDE ===
            if (draggingGuide) {
                if (dragType === 'v') {
                    let nx = dragOrig + (e.clientX - dragStart);
                    nx = Math.max(0, Math.min(window.innerWidth - 1, nx));
                    vGuides[dragIndex] = nx;
                } else if (dragType === 'h') {
                    let ny = dragOrig + (e.clientY - dragStart);
                    ny = Math.max(0, Math.min(window.innerHeight - 1, ny));
                    hGuides[dragIndex] = ny;
                }
                renderGuides();
                clearDistanceLabel();
                return;
            }
            // ... остальные действия (например, рисование прямоугольника) ...
        });
        window.addEventListener('mouseup', (e) => {
            // === RESIZE RECT ===
            if (resizingRectIdx !== null) {
                resizingRectIdx = null;
                resizingHandle = null;
                resizeStart = null;
                return;
            }
            if (draggingGuide) {
                saveGuides();
                draggingGuide = null;
                dragType = null;
                dragIndex = -1;
                document.body.style.cursor = '';
            }
        });
        // Перерисовка линеек
        function drawRulers() {
            // Горизонтальная
            rulerH.width = window.innerWidth;
            rulerH.height = 24;
            const ctxH = rulerH.getContext('2d');
            ctxH.clearRect(0, 0, rulerH.width, rulerH.height);

            // Используем булевую переменную вместо сравнения строк

            // Выбираем цвет линий и текста в зависимости от наведения
            ctxH.fillStyle = isRulerHHovered ? 'rgba(34,34,34,0.3)' : 'rgba(34,34,34,0.01)';
            ctxH.fillRect(0, 0, rulerH.width, 24);
            ctxH.strokeStyle = isRulerHHovered ? 'rgba(120,120,120,0.8)' : 'rgba(170,170,170,0.03)';

            for (let x = 0; x < rulerH.width; x += 10) {
                ctxH.beginPath();
                ctxH.moveTo(x + 0.5, 24);
                ctxH.lineTo(x + 0.5, x % 100 === 0 ? 4 : (x % 50 === 0 ? 10 : 16));
                ctxH.stroke();
                if (x % 50 === 0) {
                    ctxH.fillStyle = isRulerHHovered ? 'rgba(255,255,255,0.8)' : 'rgba(170,170,170,0.03)';
                    ctxH.font = 'bold 10px Arial';
                    ctxH.fillText(x.toString(), x + 2, 12);
                }
            }

            // Вертикальная
            rulerV.width = 24;
            rulerV.height = window.innerHeight;
            const ctxV = rulerV.getContext('2d');
            ctxV.clearRect(0, 0, 24, rulerV.height);

            // Используем булевую переменную вместо сравнения строк

            // Выбираем цвет линий и текста в зависимости от наведения
            ctxV.fillStyle = isRulerVHovered ? 'rgba(34,34,34,0.3)' : 'rgba(34,34,34,0.01)';
            ctxV.fillRect(0, 0, 24, rulerV.height);
            ctxV.strokeStyle = isRulerVHovered ? 'rgba(120,120,120,0.8)' : 'rgba(170,170,170,0.03)';

            for (let y = 0; y < rulerV.height; y += 10) {
                ctxV.beginPath();
                ctxV.moveTo(24, y + 0.5);
                ctxV.lineTo(y % 100 === 0 ? 4 : (y % 50 === 0 ? 10 : 16), y + 0.5);
                ctxV.stroke();
                if (y % 50 === 0) {
                    ctxV.fillStyle = isRulerVHovered ? 'rgba(255,255,255,0.8)' : 'rgba(170,170,170,0.03)';
                    ctxV.font = 'bold 10px Arial';
                    ctxV.fillText(y.toString(), 2, y + 10);
                }
            }

            // Рисуем вертикальные гайды на rulerH
            ctxH.strokeStyle = '#00eaff';
            vGuides.forEach(x => {
                ctxH.beginPath();
                ctxH.moveTo(x + 0.5, 0);
                ctxH.lineTo(x + 0.5, 24);
                ctxH.stroke();
            });

            // Рисуем горизонтальные гайды на rulerV
            ctxV.strokeStyle = '#00eaff';
            hGuides.forEach(y => {
                ctxV.beginPath();
                ctxV.moveTo(0, y + 0.5);
                ctxV.lineTo(24, y + 0.5);
                ctxV.stroke();
            });
        }
        window.addEventListener('resize', () => {
            drawRulers();
            renderGuides();
        });
        // Система умного управления drawingLayer для интерактивных элементов
        let interactionTimer = null;
        let isInteracting = false;

        // Функция для временного отключения drawingLayer при взаимодействии с UI
        function temporaryDisableDrawingLayer(duration = 300) {
            if (rulersOverlay.style.display === 'none') return;

            isInteracting = true;
            drawingLayer.style.pointerEvents = 'none';

            // Очищаем предыдущий таймер
            if (interactionTimer) {
                clearTimeout(interactionTimer);
            }

            // Устанавливаем новый таймер для восстановления
            interactionTimer = setTimeout(() => {
                if (rulersOverlay.style.display !== 'none') {
                    drawingLayer.style.pointerEvents = 'auto';
                    isInteracting = false;
                }
            }, duration);
        }

        // Функция для немедленного восстановления drawingLayer
        function restoreDrawingLayer() {
            if (interactionTimer) {
                clearTimeout(interactionTimer);
                interactionTimer = null;
            }
            if (rulersOverlay.style.display !== 'none') {
                drawingLayer.style.pointerEvents = 'auto';
                isInteracting = false;
            }
        }

        // Функция для отмены текущего рисования
        function cancelCurrentDrawing() {
            if (drawingRect) {
                if (drawingRect.parentNode) {
                    drawingRect.parentNode.removeChild(drawingRect);
                }
                drawingRect = null;
                drawingStart = null;
                drawingRectData = null;
                console.log('[Cancel] Рисование прямоугольника отменено');
            }
        }

        // Обработчик клавиши Escape для отмены рисования
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && drawingRect) {
                console.log('[Escape] Отмена текущего рисования');
                cancelCurrentDrawing();
                e.preventDefault();
            }
        });

        // Глобальные обработчики для автоматического управления drawingLayer
        document.addEventListener('mousedown', (e) => {
            if (rulersOverlay.style.display === 'none') return;

            // Проверяем, является ли цель интерактивным элементом в области UI
            const inUIArea = isInPanelArea(e.clientX, e.clientY);
            if (inUIArea && isInteractiveUIElement(e.target)) {
                temporaryDisableDrawingLayer(500); // Длительное отключение для drag операций
            }
        }, true);

        // Восстанавливаем при отпускании мыши
        document.addEventListener('mouseup', () => {
            if (rulersOverlay.style.display === 'none') return;

            // Восстанавливаем с небольшой задержкой
            setTimeout(() => {
                if (!isInteracting) {
                    restoreDrawingLayer();
                }
            }, 50);
        }, true);

        // Специальные обработчики для слайдеров
        document.addEventListener('input', (e) => {
            if (rulersOverlay.style.display === 'none') return;

            // Если это range input (слайдер)
            if (e.target.type === 'range' || e.target.classList.contains('frame-slider')) {
                temporaryDisableDrawingLayer(50); // Короткое отключение для input событий
            }
        }, true);

        // Показывать/скрывать guidesContainer вместе с rulersOverlay
        rulersBtn.addEventListener('click', () => {
            if (rulersOverlay.style.display === 'none') {
                rulersOverlay.style.display = 'block';
                guidesContainer.style.display = 'block';
                drawingLayer.style.display = 'block'; // Показываем слой для рисования
                drawRulers();
                renderGuides();

                // Активируем режим редактирования баннера
                window.isRulersActive = true;
                window.isBannerEditModeActive = true;

                // Обновляем цвет кнопки
                updateRulersBtnColor();
            } else {
                // Очищаем текущее рисование прямоугольника перед скрытием линеек
                if (drawingRect && drawingRect.parentNode) {
                    drawingRect.parentNode.removeChild(drawingRect);
                }
                drawingRect = null;
                drawingStart = null;
                drawingRectData = null;

                rulersOverlay.style.display = 'none';
                guidesContainer.style.display = 'none';
                drawingLayer.style.display = 'none'; // Скрываем слой для рисования

                // Очищаем таймер при отключении режима
                if (interactionTimer) {
                    clearTimeout(interactionTimer);
                    interactionTimer = null;
                }

                // Деактивируем режим линеек
                window.isRulersActive = false;
                // Проверяем, остался ли активным режим изменения ширины
                window.isBannerEditModeActive = window.isWidthControlActive === true;

                // Обновляем цвет кнопки
                updateRulersBtnColor();
            }
        });

        // Название версии сверху
        const versionLabel = document.createElement('div');
        versionLabel.textContent = 'AniPlay v' + SCRIPT_VERSION;
        Object.assign(versionLabel.style, {
            fontSize: '10px',
            color: 'rgba(255,255,255,0.7)',
            marginBottom: '4px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            width: '100%',
            textAlign: 'center'
        });
        panel.appendChild(versionLabel);
        panel.appendChild(btnContainer);
        document.body.appendChild(panel);

        // Вспомогательные функции для drag и выбора
        let draggingGuide = null;
        let dragType = null; // 'h' | 'v'
        let dragIndex = -1;
        let dragStart = 0;
        let dragOrig = 0;
        // Для выбора двух гайдов и отображения расстояния
        let selectedGuides = { h: [], v: [] };
        let distanceLabel = null;
        function clearDistanceLabel() {
            if (distanceLabel && distanceLabel.parentNode) distanceLabel.parentNode.removeChild(distanceLabel);
            distanceLabel = null;
            selectedGuides = { h: [], v: [] };
        }
        function showDistanceLabel(type, idx1, idx2) {
            clearDistanceLabel();
            if (type !== 'h' && type !== 'v') return;
            let pos1 = (type === 'h' ? hGuides[idx1] : vGuides[idx1]);
            let pos2 = (type === 'h' ? hGuides[idx2] : vGuides[idx2]);
            let d = Math.abs(pos2 - pos1);
            // Создаём метку
            distanceLabel = document.createElement('div');
            distanceLabel.textContent = d + ' px';
            Object.assign(distanceLabel.style, {
                position: 'fixed',
                zIndex: '2147483648',
                background: 'rgba(0,0,0,0.85)',
                color: '#fff',
                fontSize: '13px',
                padding: '2px 8px',
                borderRadius: '6px',
                pointerEvents: 'none',
                fontWeight: 'bold',
                boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                userSelect: 'none',
                letterSpacing: '0.5px',
            });
            if (type === 'v') {
                // Вертикальные: метка по центру между x1 и x2, сверху
                let x = (pos1 + pos2) / 2;
                distanceLabel.style.left = (x - 24) + 'px';
                distanceLabel.style.top = '28px';
            } else {
                // Горизонтальные: метка по центру между y1 и y2, слева
                let y = (pos1 + pos2) / 2;
                distanceLabel.style.left = '32px';
                distanceLabel.style.top = (y - 12) + 'px';
            }
            guidesContainer.appendChild(distanceLabel);
        }

        // Функция для добавления возможности перетаскивания прямоугольника
        function makeRectDraggable(element, idx) {
            let isDragging = false;
            let offsetX, offsetY;

            // Заменяем глобальный слушатель, добавляем прослушивание только на сам элемент
            element.addEventListener('mousedown', (e) => {
                // Если клик не на самом прямоугольнике (например, на маркере), игнорируем
                if (e.target !== element) return;

                // Если Shift зажат - копируем прямоугольник (эта функциональность уже реализована в обработчике)
                if (e.shiftKey) return;

                // Проверяем, не перемещаем ли мы уже этот прямоугольник через другой механизм
                if (movingRectIdx === idx) return;

                // Обычное перемещение
                isDragging = true;
                offsetX = e.clientX - parseInt(element.style.left);
                offsetY = e.clientY - parseInt(element.style.top);

                // Добавляем визуальную обратную связь
                element.style.cursor = 'move';
                e.stopPropagation(); // Предотвращаем создание нового прямоугольника
            });

            const moveHandler = (e) => {
                if (isDragging) {
                    const newLeft = e.clientX - offsetX;
                    const newTop = e.clientY - offsetY;

                    // Обновляем DOM элемент
                    element.style.left = `${newLeft}px`;
                    element.style.top = `${newTop}px`;

                    // Синхронизируем с данными в массиве прямоугольников
                    if (drawnRects[idx]) {
                        drawnRects[idx].left = newLeft;
                        drawnRects[idx].top = newTop;
                    }

                    e.preventDefault();
                    e.stopPropagation(); // Останавливаем всплытие события
                }
            };

            const upHandler = () => {
                if (isDragging) {
                    isDragging = false;
                    element.style.cursor = 'grab';
                }
            };

            // Используем capture фазу для событий
            document.addEventListener('mousemove', moveHandler, true);
            document.addEventListener('mouseup', upHandler, true);

            // Удаляем слушателей при удалении из DOM
            element.addEventListener('remove', () => {
                document.removeEventListener('mousemove', moveHandler, true);
                document.removeEventListener('mouseup', upHandler, true);
            });
        }

            // Добавляем визуальные подсказки при наведении мыши
            // ЗАМЕНЕН НА ОБЪЕДИНЕННЫЙ ОБРАБОТЧИК ВЫШЕ
            /* drawingLayer.addEventListener('mousemove', (e) => {
                if (rulersOverlay.style.display === 'none') return;

                const mouseX = e.clientX;
                const mouseY = e.clientY;

                // Определяем, можно ли рисовать прямоугольник в данной позиции
                const canDrawRect = !isInRulerArea(mouseX, mouseY) &&
                                  !isInPanelArea(mouseX, mouseY) &&
                                  !isNearGuide(mouseX, mouseY) &&
                                  !isNearRectangleEdge(mouseX, mouseY) &&
                                  !isDraggingNewGuide &&
                                  !draggingGuide &&
                                  !drawingRect &&
                                  resizingRectIdx === null;

                // Изменяем курсор в зависимости от возможности рисования
                if (canDrawRect) {
                    drawingLayer.style.cursor = 'crosshair';
                } else if (isInRulerArea(mouseX, mouseY)) {
                    drawingLayer.style.cursor = mouseX <= 24 ? 'ew-resize' : 'ns-resize';
                } else if (isInPanelArea(mouseX, mouseY)) {
                    drawingLayer.style.cursor = 'default'; // Обычный курсор над панелью
                } else if (isNearGuide(mouseX, mouseY)) {
                    // Определяем тип ближайшего гайда для курсора
                    let nearVertical = false;
                    for (let guideX of vGuides) {
                        if (Math.abs(mouseX - guideX) <= 5) {
                            nearVertical = true;
                            break;
                        }
                    }
                    drawingLayer.style.cursor = nearVertical ? 'ew-resize' : 'ns-resize';
                } else {
                    drawingLayer.style.cursor = 'default';
                }
            });

            drawingLayer.addEventListener('mouseleave', () => {
                drawingLayer.style.cursor = 'default';
            }); */
        } // Закрываем функцию initializePanelComponents

        // Запускаем проверку контейнера
        checkAnimationContainer();
    } // Закрываем функцию initAnimatePanel

    // === СИСТЕМА МОНИТОРИНГА И АВТОМАТИЧЕСКОГО ПЕРЕЗАПУСКА ===

    // Глобальная переменная для предотвращения повторного запуска
    const SCRIPT_INSTANCE_KEY = 'aniplay_script_running';

    // Проверяем, не запущен ли уже другой экземпляр скрипта
    if (window[SCRIPT_INSTANCE_KEY]) {
        console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Скрипт уже запущен, прекращение инициализации текущего экземпляра`);
        return;
    }

    // Отмечаем что скрипт запущен
    window[SCRIPT_INSTANCE_KEY] = true;
    console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Инициализация системы мониторинга...`);

    // Глобальные переменные для отслеживания состояния
    let isScriptInitialized = false;
    let isScriptInitializing = false; // Новый флаг для предотвращения одновременной инициализации
    let monitoringInterval = null;
    let consecutiveChecks = 0;
    const MAX_CONSECUTIVE_CHECKS = 5;
    const CHECK_INTERVAL_MS = 2000;

    // Функция проверки наличия баннера Adobe Animate
    function checkAnimateBannerExists() {
        // Проверяем наличие контейнера анимации
        const animationContainer = document.getElementById('animation_container');
        if (!animationContainer) {
            return false;
        }

        // Проверяем наличие createjs объектов
        if (typeof createjs === 'undefined' ||
            !createjs.Ticker ||
            typeof createjs.Ticker.framerate !== 'number') {
            return false;
        }

        // Проверяем наличие exportRoot
        if (typeof window.exportRoot === 'undefined') {
            return false;
        }

        console.log('[AniPlay Monitor] Баннер Adobe Animate обнаружен');
        return true;
    }

    // Функция проверки, запущен ли скрипт (есть ли панель)
    function checkScriptRunning() {
        // Первичная проверка глобальной переменной
        if (!window[SCRIPT_INSTANCE_KEY]) {
            return false;
        }

        // Улучшенный поиск панели с более точными критериями
        const existingPanels = document.querySelectorAll('div[style*="position: fixed"]');
        for (let panel of existingPanels) {
            // Проверяем наличие уникального класса или атрибутов нашей панели
            if (panel.style.zIndex === '9999' &&
                (panel.querySelector('input[type="range"].frame-slider') ||
                 panel.querySelector('button[title*="FPS"]') ||
                 panel.querySelector('div[style*="font-weight: bold"][style*="color: #fff"]'))) {
                console.log('[AniPlay Monitor] Обнаружена существующая панель');
                return true;
            }
        }

        // Дополнительная проверка по уникальному идентификатору
        if (document.querySelector('.aniplay-panel')) {
            console.log('[AniPlay Monitor] Найдена панель по классу');
            return true;
        }

        return false;
    }

    // Функция проверки успешного запуска панели на странице с баннером
    function checkPanelSuccessfullyLaunched() {
        const bannerExists = checkAnimateBannerExists();
        const scriptRunning = checkScriptRunning();

        // Если баннер есть, то скрипт должен работать
        if (bannerExists && !scriptRunning) {
            return false; // Неуспешный запуск - баннер есть, но панель не работает
        }

        // Если баннера нет, то проверка не нужна
        if (!bannerExists) {
            return true; // Считаем "успешным" - нет баннера, нет необходимости в панели
        }

        // Баннер есть и скрипт работает - успех
        return true;
    }

    // Функция мониторинга
    function monitorScriptState() {
        const scriptRunning = checkScriptRunning();

        console.log(`[AniPlay Monitor] Проверка ${consecutiveChecks + 1}/${MAX_CONSECUTIVE_CHECKS}: Скрипт=${scriptRunning}`);

        if (!scriptRunning) {
            consecutiveChecks++;

            if (consecutiveChecks >= MAX_CONSECUTIVE_CHECKS) {
                console.log('[AniPlay Monitor] Скрипт не запущен, попытка перезапуска...');
                initializeScript();
                return;
            }
        } else {
            // Сбрасываем счетчик если скрипт работает
            consecutiveChecks = 0;

            // Если скрипт работает, отмечаем как инициализированный
            if (scriptRunning) {
                isScriptInitialized = true;
            }
        }
    }

    // Функция запуска мониторинга
    function startMonitoring() {
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
        }

        console.log('[AniPlay Monitor] Запуск системы мониторинга...');
        monitoringInterval = setInterval(monitorScriptState, CHECK_INTERVAL_MS);
    }

    // Основная точка входа с мониторингом
    function mainEntry() {
        console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Запуск скрипта...`);

        // Дополнительная проверка на уже запущенный скрипт
        if (checkScriptRunning()) {
            console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Скрипт уже запущен, отмена запуска нового экземпляра`);
            return;
        }

        // Инициализируем скрипт напрямую без проверки баннера
        console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Инициализация скрипта...`);
        initializeScript();
    }

    // Запуск при загрузке страницы
    if (document.readyState === 'loading') {
        window.addEventListener('load', mainEntry);
    } else {
        // Если страница уже загружена
        mainEntry();
    }

    // Дополнительная проверка при изменении DOM (для SPA)
    let domObserver = null;
    if (window.MutationObserver) {
        domObserver = new MutationObserver((mutations) => {
            let shouldCheck = false;

            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Проверяем, добавились ли элементы связанные с Adobe Animate
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1) { // Element node
                            if (node.id === 'animation_container' ||
                                node.id === 'canvas' ||
                                (node.querySelector && (
                                    node.querySelector('#animation_container') ||
                                    node.querySelector('#canvas')
                                ))) {
                                shouldCheck = true;
                            }
                        }
                    });
                }
            });

            // Проверяем состояние скрипта при обнаружении элементов баннера
            if (shouldCheck) {
                console.log('[AniPlay Monitor] Обнаружены элементы баннера в DOM, проверка состояния...');
                setTimeout(() => {
                    // Дополнительные проверки перед попыткой инициализации
                    if (isScriptInitializing) {
                        console.log('[AniPlay Monitor] Инициализация уже выполняется, пропуск DOM обработки');
                        return;
                    }

                    if (checkScriptRunning()) {
                        console.log('[AniPlay Monitor] Скрипт уже запущен, пропуск DOM обработки');
                        return;
                    }

                    const bannerExists = checkAnimateBannerExists();
                    const scriptRunning = checkScriptRunning();

                    console.log(`[AniPlay Monitor] DOM изменился: Баннер=${bannerExists}, Скрипт=${scriptRunning}, Инициализирован=${isScriptInitialized}`);

                    // Если баннер появился и скрипт не работает И не инициализирован - пытаемся инициализировать
                    if (bannerExists && !scriptRunning && !isScriptInitialized && !isScriptInitializing) {
                        console.log('[AniPlay Monitor] Баннер появился, скрипт не работает - попытка инициализации через DOM...');
                        initializeScript();
                    }
                }, 1000);
            }
        });

        domObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // УДАЛЕН дублирующий обработчик load - уже есть в mainEntry()
    // window.addEventListener('load', () => {
    //     waitForCreatejsTickerAndInitPanel();
    // });

    // Функция инициализации скрипта
    function initializeScript() {
        // Блокируем одновременную инициализацию
        if (isScriptInitializing) {
            console.log('[AniPlay Monitor] Инициализация уже выполняется, ожидание...');
            return;
        }

        // Проверяем еще раз перед инициализацией
        if (checkScriptRunning()) {
            console.log('[AniPlay Monitor] Скрипт уже запущен, пропуск инициализации');
            return;
        }

        // Проверяем флаг инициализации
        if (isScriptInitialized) {
            console.log('[AniPlay Monitor] Скрипт уже инициализирован, пропуск повторной инициализации');
            return;
        }

        console.log('[AniPlay Monitor] Начало инициализации скрипта...');
        isScriptInitializing = true; // Устанавливаем флаг инициализации
        isScriptInitialized = true;
        consecutiveChecks = 0;

        // Останавливаем мониторинг на время инициализации
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
            monitoringInterval = null;
        }

        // Запускаем основную функцию
        waitForCreatejsTickerAndInitPanel();

        // Снимаем флаг инициализации через небольшую задержку
        setTimeout(() => {
            isScriptInitializing = false;
            console.log('[AniPlay Monitor] Инициализация завершена');

            // Перезапускаем мониторинг через дополнительную задержку, но только если есть баннер
            setTimeout(() => {
                if (checkAnimateBannerExists()) {
                    startMonitoring();
                } else {
                    console.log('[AniPlay Monitor] Баннер не обнаружен, мониторинг не запускается');
                }
            }, 3000);
        }, 2000);
    }

    // Функция очистки при завершении работы
    function cleanupScript() {
        console.log('[AniPlay Monitor] Очистка скрипта...');
        window[SCRIPT_INSTANCE_KEY] = false;
        isScriptInitialized = false;
        isScriptInitializing = false; // Очищаем и флаг инициализации

        if (monitoringInterval) {
            clearInterval(monitoringInterval);
            monitoringInterval = null;
        }
    }

    // Обработчик закрытия страницы
    window.addEventListener('beforeunload', cleanupScript);

    // Обработчик видимости страницы (для SPA)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Страница скрыта, но не закрыта - не очищаем
            console.log('[AniPlay Monitor] Страница скрыта');
        } else {
            // Страница стала видимой
            console.log('[AniPlay Monitor] Страница стала видимой');
        }
    });

    // Функция мониторинга
    function monitorScriptState() {
        const bannerExists = checkAnimateBannerExists();
        const scriptRunning = checkScriptRunning();
        const panelLaunched = checkPanelSuccessfullyLaunched();

        console.log(`[AniPlay Monitor] Проверка ${consecutiveChecks + 1}/${MAX_CONSECUTIVE_CHECKS}: Баннер=${bannerExists}, Скрипт=${scriptRunning}, Успешный_запуск=${panelLaunched}`);

        // Если нет баннера - останавливаем мониторинг
        if (!bannerExists) {
            console.log('[AniPlay Monitor] Баннер не обнаружен, остановка мониторинга');
            if (monitoringInterval) {
                clearInterval(monitoringInterval);
                monitoringInterval = null;
            }
            return;
        }

        // Если есть баннер, но панель не запущена
        if (!panelLaunched) {
            consecutiveChecks++;

            if (consecutiveChecks >= MAX_CONSECUTIVE_CHECKS) {
                console.log('[AniPlay Monitor] Панель не запущена на странице с баннером, попытка перезапуска...');
                isScriptInitialized = false; // Сбрасываем флаг для возможности перезапуска
                initializeScript();
                return;
            }
        } else {
            // Сбрасываем счетчик если все работает корректно
            consecutiveChecks = 0;

            // Если панель успешно запущена, отмечаем как инициализированную
            if (panelLaunched) {
                isScriptInitialized = true;
            }
        }
    }

    // Функция запуска мониторинга
    function startMonitoring() {
        // Запускаем мониторинг только если есть баннер
        if (!checkAnimateBannerExists()) {
            console.log('[AniPlay Monitor] Баннер не обнаружен, мониторинг не запускается');
            return;
        }

        if (monitoringInterval) {
            clearInterval(monitoringInterval);
        }

        console.log('[AniPlay Monitor] Запуск системы мониторинга...');
        monitoringInterval = setInterval(monitorScriptState, CHECK_INTERVAL_MS);
    }

    // Основная точка входа с мониторингом
    function mainEntry() {
        console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Запуск скрипта...`);

        // Дополнительная проверка на уже запущенный скрипт
        if (checkScriptRunning()) {
            console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Скрипт уже запущен, отмена запуска нового экземпляра`);
            return;
        }

        // Проверяем наличие баннера
        const bannerExists = checkAnimateBannerExists();
        console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Баннер обнаружен: ${bannerExists}`);

        if (bannerExists) {
            // Если есть баннер - инициализируем скрипт и запускаем мониторинг
            console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Инициализация скрипта для страницы с баннером...`);
            initializeScript();
        } else {
            // Если нет баннера - просто пытаемся инициализировать один раз без мониторинга
            console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Страница без баннера, разовая попытка инициализации...`);
            waitForCreatejsTickerAndInitPanel();
        }
    }
})();

