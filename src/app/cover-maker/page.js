'use client';

import React, { useState, useRef, useEffect } from 'react';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import ClientLayout from '@/components/ClientLayout';
import * as htmlToImage from 'html-to-image';
import Cropper from 'react-easy-crop';

export default function CoverMakerPage() {
  const [activeTemplate, setActiveTemplate] = useState('template1');
  const [showYellowBorder, setShowYellowBorder] = useState(false);

  const [slots, setSlots] = useState([
    { image: '', crop: { x: 0, y: 0 }, zoom: 1, blur: 0, edgeFade: 0, fadeDirection: 'radial', smartFit: false, stretchFit: false },
    { image: '', crop: { x: 0, y: 0 }, zoom: 1, blur: 0, edgeFade: 0, fadeDirection: 'radial', smartFit: false, stretchFit: false },
    { image: '', crop: { x: 0, y: 0 }, zoom: 1, blur: 0, edgeFade: 0, fadeDirection: 'radial', smartFit: false, stretchFit: false },
    { image: '', crop: { x: 0, y: 0 }, zoom: 1, blur: 0, edgeFade: 0, fadeDirection: 'radial', smartFit: false, stretchFit: false },
    { image: '', crop: { x: 0, y: 0 }, zoom: 1, blur: 0, edgeFade: 0, fadeDirection: 'radial', smartFit: false, stretchFit: false }, // Center/Focus
  ]);
  const [globalBlur, setGlobalBlur] = useState(0);
  const [centerBorder, setCenterBorder] = useState(true);
  const [showLayoutLines, setShowLayoutLines] = useState(false);
  const [blurMode, setBlurMode] = useState('dark');

  const [showHunter, setShowHunter] = useState(false);
  const [hunterQuery, setHunterQuery] = useState('');
  const [hunterMode, setHunterMode] = useState('images');
  const [hunterResults, setHunterResults] = useState([]);
  const [isHunting, setIsHunting] = useState(false);
  const [hunterTargetSlot, setHunterTargetSlot] = useState(null);

  const handleHuntImages = async () => {
    if (!hunterQuery.trim()) return;
    setIsHunting(true);
    setHunterResults([]);
    try {
      const res = await fetch('/api/image-hunter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: hunterQuery, mode: hunterMode })
      });
      const data = await res.json();
      if (data.success) {
        setHunterResults(data.data || []);
      } else {
        alert(data.error);
      }
    } catch (e) {
      alert('Error fetching images');
    }
    setIsHunting(false);
  };

  const [text1, setText1] = useState('พาดหัวข่าวใหญ่');
  const [text2, setText2] = useState('พาดหัวข่าวรอง หรือหัวข้อย่อย');
  const [text3, setText3] = useState('');
  const [textStyle, setTextStyle] = useState('draggable');
  const [textSize, setTextSize] = useState(48);
  const [textPos, setTextPos] = useState({ x: 80, y: 1100 });
  
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef(null);
  
  const coverRef = useRef(null);
  const [scale, setScale] = useState(0.5); 
  const [isExporting, setIsExporting] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(null);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1200) setScale(0.35);
      else if (window.innerWidth < 1400) setScale(0.45);
      else setScale(0.55);
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handlePointerDown = (e) => {
    setIsDragging(true);
    e.target.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, initPosX: textPos.x, initPosY: textPos.y };
  };

  const handlePointerMove = (e) => {
    if (!isDragging || !dragRef.current) return;
    const dx = (e.clientX - dragRef.current.startX) / scale;
    const dy = (e.clientY - dragRef.current.startY) / scale;
    setTextPos({
      x: dragRef.current.initPosX + dx,
      y: dragRef.current.initPosY + dy,
    });
  };

  const handlePointerUp = (e) => {
    setIsDragging(false);
    e.target.releasePointerCapture(e.pointerId);
  };

  const updateSlot = (index, key, value) => {
    setSlots(prev => {
      const newSlots = [...prev];
      newSlots[index] = { ...newSlots[index], [key]: value };
      return newSlots;
    });
  };

  const handleFileUpload = (index, event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => updateSlot(index, 'image', reader.result);
      reader.readAsDataURL(file);
    }
  };

  const removeImage = (index) => {
    updateSlot(index, 'image', '');
    updateSlot(index, 'zoom', 1);
    updateSlot(index, 'crop', { x: 0, y: 0 });
    updateSlot(index, 'smartFit', false);
    updateSlot(index, 'stretchFit', false);
  };

  const exportImage = async () => {
    if (!coverRef.current) return;
    setIsExporting(true);
    try {
      const dataUrl = await htmlToImage.toJpeg(coverRef.current, { 
        quality: 0.95,
        width: 1080,
        height: 1350,
        style: { transform: 'scale(1)', transformOrigin: 'top left' },
        pixelRatio: 1
      });
      const link = document.createElement('a');
      link.download = `Premium-Cover-${activeTemplate}-${Date.now()}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export image', err);
      alert('เกิดข้อผิดพลาดในการเซฟรูปภาพ');
    }
    setIsExporting(false);
  };

  const defaultPlaceholder = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 100 100"><rect width="100" height="100" fill="%231a1a2e" /><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%233a3a5e" font-size="10" font-family="sans-serif">NO IMAGE</text></svg>';

  const slotConfig = activeTemplate === 'template1' ? [
    { label: 'Top Left Quadrant', icon: '↖️' },
    { label: 'Top Right Quadrant', icon: '↗️' },
    { label: 'Bottom Left Quadrant', icon: '↙️' },
    { label: 'Bottom Right Quadrant', icon: '↘️' },
    { label: 'Center Focus (Circle)', icon: '🎯' },
  ] : activeTemplate === 'template2' ? [
    { label: 'Left Tall Half (50% x 100%)', icon: '⬅️' },
    { label: 'Top Right (50% x 33%)', icon: '↗️' },
    { label: 'Middle Right (50% x 33%)', icon: '➡️' },
    { label: 'Bottom Right (50% x 33%)', icon: '↘️' },
    { label: 'Bottom Left Focus (Circle)', icon: '🎯' },
  ] : activeTemplate === 'template4' ? [
    { label: 'Left Main (55% x 100%)', icon: '⬅️', edgeFade: 20, fadeDirection: 'right', overlapSize: 40 },
    { label: 'Top Right (50% x 50%)', icon: '↗️', edgeFade: 15, fadeDirection: 'left', overlapSize: 40 },
    { label: 'Bottom Right (50% x 50%)', icon: '↘️', edgeFade: 15, fadeDirection: 'left', overlapSize: 40 },
    { label: 'Floating Inset (Neon)', icon: '🎴' },
    { label: 'Bottom Left (Circle)', icon: '🎯' },
  ] : activeTemplate === 'template5' ? [
    { label: 'Left Main (55% x 100%)', icon: '⬅️', edgeFade: 20, fadeDirection: 'right', overlapSize: 40 },
    { label: 'Top Right (50% x 50%)', icon: '↗️', edgeFade: 15, fadeDirection: 'left', overlapSize: 40 },
    { label: 'Bottom Right (50% x 50%)', icon: '↘️', edgeFade: 15, fadeDirection: 'left', overlapSize: 40 },
    { label: 'Floating Inset (Yellow)', icon: '🎴' },
    { label: 'Bottom Left (Circle)', icon: '🎯' },
  ] : activeTemplate === 'template6' ? [
    { label: 'Top Left (55% x 50%)', icon: '↖️', edgeFade: 15, fadeDirection: 'fade-bottom-right', overlapSize: 40 },
    { label: 'Bottom Left (55% x 50%)', icon: '↙️', edgeFade: 15, fadeDirection: 'fade-top-right', overlapSize: 40 },
    { label: 'Top Right (45% x 50%)', icon: '↗️', edgeFade: 15, fadeDirection: 'left', overlapSize: 40 },
    { label: 'Bottom Right (45% x 50%)', icon: '↘️', edgeFade: 15, fadeDirection: 'left', overlapSize: 40 },
    { label: 'Center Inset (Rectangle)', icon: '🎴' },
  ] : activeTemplate === 'template7' ? [
    { label: 'Top Left (50% x 50%)', icon: '↖️', edgeFade: 20, fadeDirection: 'fade-bottom-right', overlapSize: 40 },
    { label: 'Top Right (50% x 50%)', icon: '↗️', edgeFade: 20, fadeDirection: 'fade-bottom-left', overlapSize: 40 },
    { label: 'Bottom Left (50% x 50%)', icon: '↙️', edgeFade: 20, fadeDirection: 'fade-top-right', overlapSize: 40 },
    { label: 'Bottom Right (50% x 50%)', icon: '↘️', edgeFade: 20, fadeDirection: 'fade-top-left', overlapSize: 40 },
    { label: 'Center Focus (Circle)', icon: '🎯' },
  ] : [
    { label: 'Top Left (50% x 45%)', icon: '↖️' },
    { label: 'Top Right (50% x 45%)', icon: '↗️' },
    { label: 'Bottom Left (50% x 55%)', icon: '↙️' },
    { label: 'Bottom Right (50% x 55%)', icon: '↘️' },
    { label: 'Center Focus (Small Circle)', icon: '🎯' },
  ];

  // Helper function to render a grid slot
  const renderSlot = (idx, posStyle, aspect, isYellowBorder = false) => {
    const totalBlur = globalBlur + slots[idx].blur;
    const edgeFade = slots[idx].edgeFade || 0;
    const fadeDirection = slots[idx].fadeDirection || 'radial';
    
    let maskStyle = {};
    let vignetteStyle = {};
    
    let maskPercent = 100;
    if (edgeFade > 0) maskPercent = 100 - edgeFade;
    else if (blurMode === 'transparent' && totalBlur > 0) maskPercent = 100 - totalBlur;
    else if (blurMode === 'dark' && totalBlur > 0) maskPercent = 100 - (totalBlur * 0.8);
    
    if (maskPercent < 100) {
      let maskValue = `radial-gradient(ellipse at center, black ${maskPercent}%, transparent 100%)`;
      if (fadeDirection === 'right') maskValue = `linear-gradient(to right, black ${maskPercent}%, transparent 100%)`;
      else if (fadeDirection === 'left') maskValue = `linear-gradient(to left, black ${maskPercent}%, transparent 100%)`;
      else if (fadeDirection === 'top') maskValue = `linear-gradient(to top, black ${maskPercent}%, transparent 100%)`;
      else if (fadeDirection === 'bottom') maskValue = `linear-gradient(to bottom, black ${maskPercent}%, transparent 100%)`;
      else if (fadeDirection === 'fade-bottom-right') maskValue = `radial-gradient(ellipse at top left, black ${maskPercent}%, transparent 100%)`;
      else if (fadeDirection === 'fade-top-right') maskValue = `radial-gradient(ellipse at bottom left, black ${maskPercent}%, transparent 100%)`;
      else if (fadeDirection === 'fade-bottom-left') maskValue = `radial-gradient(ellipse at top right, black ${maskPercent}%, transparent 100%)`;
      else if (fadeDirection === 'fade-top-left') maskValue = `radial-gradient(ellipse at bottom right, black ${maskPercent}%, transparent 100%)`;

      maskStyle = {
        WebkitMaskImage: maskValue,
        maskImage: maskValue
      };
    }
    
    let finalPos = { ...posStyle };
    const overlapSize = slots[idx].overlapSize || 0;
    if (overlapSize > 0) {
      if (fadeDirection === 'right') {
        finalPos.width = `calc(${posStyle.width} + ${overlapSize}px)`;
      } else if (fadeDirection === 'left') {
        finalPos.width = `calc(${posStyle.width} + ${overlapSize}px)`;
        if (posStyle.left !== undefined) finalPos.left = `calc(${posStyle.left} - ${overlapSize}px)`;
      } else if (fadeDirection === 'bottom') {
        finalPos.height = `calc(${posStyle.height} + ${overlapSize}px)`;
      } else if (fadeDirection === 'top') {
        finalPos.height = `calc(${posStyle.height} + ${overlapSize}px)`;
        if (posStyle.top !== undefined) finalPos.top = `calc(${posStyle.top} - ${overlapSize}px)`;
      } else if (fadeDirection === 'radial') {
        finalPos.width = `calc(${posStyle.width} + ${overlapSize*2}px)`;
        finalPos.height = `calc(${posStyle.height} + ${overlapSize*2}px)`;
        if (posStyle.left !== undefined) finalPos.left = `calc(${posStyle.left} - ${overlapSize}px)`;
        if (posStyle.top !== undefined) finalPos.top = `calc(${posStyle.top} - ${overlapSize}px)`;
      } else if (fadeDirection === 'fade-bottom-right' || fadeDirection === 'fade-top-right' || fadeDirection === 'fade-bottom-left' || fadeDirection === 'fade-top-left') {
        finalPos.width = `calc(${posStyle.width} + ${overlapSize}px)`;
        finalPos.height = `calc(${posStyle.height} + ${overlapSize}px)`;
      }
    }
    const zIndex = 10 + idx;

    if (blurMode === 'dark' && totalBlur > 0) {
      vignetteStyle = { boxShadow: `inset 0 0 ${totalBlur*1.5}px ${totalBlur}px #000` };
    }

    return (
      <div key={idx} style={{ overflow: 'hidden', position: 'absolute', background: '#000', zIndex, ...finalPos }}>
        {slots[idx].image ? (
          <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, ...maskStyle }}>
            {slots[idx].smartFit && !slots[idx].stretchFit && (
              <img src={slots[idx].image} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(30px) brightness(0.8)', transform: 'scale(1.2)' }} alt="" />
            )}
            {slots[idx].stretchFit ? (
              <img src={slots[idx].image} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill' }} alt="" />
            ) : (
              <Cropper
                image={slots[idx].image}
                crop={slots[idx].crop}
                zoom={slots[idx].zoom}
                minZoom={slots[idx].smartFit ? 0.1 : 1}
                restrictPosition={!slots[idx].smartFit}
                aspect={aspect}
                onCropChange={(c) => updateSlot(idx, 'crop', c)}
                onZoomChange={(z) => updateSlot(idx, 'zoom', z)}
                showGrid={false}
                style={{ 
                  containerStyle: { width: '100%', height: '100%' }, 
                  mediaStyle: { objectFit: slots[idx].smartFit ? 'contain' : 'cover' },
                  cropAreaStyle: { border: 'none', boxShadow: 'none' }
                }}
              />
            )}
          </div>
        ) : (
          <img src={defaultPlaceholder} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
        )}
        {blurMode === 'dark' && (
          <div style={{ position: 'absolute', inset: 0, ...vignetteStyle, pointerEvents: 'none', zIndex: 5 }}/>
        )}
        {isYellowBorder && (
          <div style={{ position: 'absolute', inset: 0, border: '8px solid #facc15', pointerEvents: 'none', zIndex: 6 }}/>
        )}
      </div>
    );
  };

  // Helper function to render the center/focus circle
  const renderCircleSlot = (posStyle) => {
    const totalBlur = globalBlur + slots[4].blur;
    const edgeFade = slots[4].edgeFade || 0;

    let maskPercent = 100;
    if (edgeFade > 0) maskPercent = 100 - edgeFade;
    else if (blurMode === 'transparent' && totalBlur > 0) maskPercent = 100 - totalBlur;
    else if (blurMode === 'dark' && totalBlur > 0) maskPercent = 100 - (totalBlur * 0.8);
    
    let maskStyle = {};
    if (maskPercent < 100) {
      maskStyle = {
        WebkitMaskImage: `radial-gradient(circle at center, black ${maskPercent}%, transparent 100%)`,
        maskImage: `radial-gradient(circle at center, black ${maskPercent}%, transparent 100%)`
      };
    }

    let vignetteStyle = {};
    if (blurMode === 'dark' && totalBlur > 0) {
      vignetteStyle = { boxShadow: `inset 0 0 ${totalBlur*1.5}px ${totalBlur}px #000` };
    }

    return (
      <div style={{
        position: 'absolute', transform: 'translate(-50%, -50%)',
        width: posStyle.width || 480, height: posStyle.height || 480, borderRadius: '50%', 
        border: centerBorder ? (posStyle.border || '16px solid #fff') : 'none', 
        overflow: 'hidden', background: '#000',
        zIndex: 50,
        ...posStyle,
        ...maskStyle
      }}>
        {slots[4].image ? (
          <div style={{
            width: '100%', height: '100%', position: 'absolute', inset: 0,
            WebkitMaskImage: (!centerBorder && totalBlur > 0) ? `radial-gradient(circle, black ${100 - totalBlur}%, transparent 100%)` : 'none'
          }}>
            {slots[4].smartFit && !slots[4].stretchFit && (
              <img src={slots[4].image} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(30px) brightness(0.8)', transform: 'scale(1.2)' }} alt="" />
            )}
            {slots[4].stretchFit ? (
              <img src={slots[4].image} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill' }} alt="" />
            ) : (
              <Cropper
                image={slots[4].image}
                crop={slots[4].crop}
                zoom={slots[4].zoom}
                minZoom={slots[4].smartFit ? 0.1 : 1}
                restrictPosition={!slots[4].smartFit}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={(c) => updateSlot(4, 'crop', c)}
                onZoomChange={(z) => updateSlot(4, 'zoom', z)}
                style={{ 
                  containerStyle: { width: '100%', height: '100%' },
                  mediaStyle: { objectFit: slots[4].smartFit ? 'contain' : 'cover' },
                  cropAreaStyle: { border: 'none', boxShadow: 'none' }
                }}
              />
            )}
          </div>
        ) : (
          <img src={defaultPlaceholder} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
        )}
        {(!centerBorder && blurMode === 'dark' && totalBlur > 0) && (
          <div style={{ position: 'absolute', inset: 0, boxShadow: `inset 0 0 ${totalBlur*2}px ${totalBlur*1.5}px #000`, pointerEvents: 'none', borderRadius: '50%', zIndex: 5 }}/>
        )}
      </div>
    );
  };

  return (
    <ClientLayout>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0a0a0f', color: '#fff', fontFamily: "'Inter', 'Noto Sans Thai', sans-serif" }}>
        <Sidebar activePath="/cover-maker" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Header title="✨ Premium Cover Studio" />
          
          <main style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '-10%', left: '-10%', width: '50%', height: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, rgba(0,0,0,0) 70%)', zIndex: 0, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: '-10%', right: '-10%', width: '50%', height: '50%', background: 'radial-gradient(circle, rgba(236,72,153,0.1) 0%, rgba(0,0,0,0) 70%)', zIndex: 0, pointerEvents: 'none' }} />
            
            {/* Left Panel: Premium Controls */}
            <div style={{ 
              width: 500, background: 'rgba(20, 20, 30, 0.7)', backdropFilter: 'blur(20px)',
              borderRight: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column',
              zIndex: 1, boxShadow: '10px 0 30px rgba(0,0,0,0.5)'
            }}>
              
              {/* Scrollable Settings Area */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px' }}>
                <div style={{ marginBottom: 32 }}>
                  <h2 style={{ fontSize: 24, fontWeight: 800, background: 'linear-gradient(90deg, #818cf8, #f472b6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 8 }}>
                    Cover Configuration
                  </h2>
                  <p style={{ color: '#8892b0', fontSize: 14 }}>ระบบจัดหน้าปกไวรัลครบวงจร พร้อมระบบแทมเพลต</p>
                </div>

                {/* Template Selector */}
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #818cf8', borderRadius: 16, padding: 20, marginBottom: 24, boxShadow: '0 0 20px rgba(129, 140, 248, 0.1)' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-block', width: 4, height: 16, background: '#818cf8', borderRadius: 2 }}/>
                    Choose Template (เลือกรูปแบบ)
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <button 
                      onClick={() => setActiveTemplate('template1')}
                      style={{ 
                        padding: '12px 8px', borderRadius: 12, border: activeTemplate === 'template1' ? '2px solid #818cf8' : '2px solid rgba(255,255,255,0.1)',
                        background: activeTemplate === 'template1' ? 'rgba(129, 140, 248, 0.1)' : 'rgba(0,0,0,0.3)',
                        color: activeTemplate === 'template1' ? '#fff' : '#94a3b8', cursor: 'pointer', transition: 'all 0.2s', fontWeight: 600, fontSize: 11
                      }}
                    >
                      <div style={{ fontSize: 20, marginBottom: 4 }}>🔲</div>
                      Template 1<br/><span style={{ fontSize: 9, fontWeight: 400 }}>(Classic Grid)</span>
                    </button>
                    <button 
                      onClick={() => setActiveTemplate('template2')}
                      style={{ 
                        padding: '12px 8px', borderRadius: 12, border: activeTemplate === 'template2' ? '2px solid #f472b6' : '2px solid rgba(255,255,255,0.1)',
                        background: activeTemplate === 'template2' ? 'rgba(244, 114, 182, 0.1)' : 'rgba(0,0,0,0.3)',
                        color: activeTemplate === 'template2' ? '#fff' : '#94a3b8', cursor: 'pointer', transition: 'all 0.2s', fontWeight: 600, fontSize: 11
                      }}
                    >
                      <div style={{ fontSize: 20, marginBottom: 4 }}>📑</div>
                      Template 2<br/><span style={{ fontSize: 9, fontWeight: 400 }}>(Vertical)</span>
                    </button>
                    <button
                      onClick={() => setActiveTemplate('template3')}
                      style={{
                        padding: '12px 8px', borderRadius: 12, border: activeTemplate === 'template3' ? '2px solid #38bdf8' : '2px solid rgba(255,255,255,0.1)',
                        background: activeTemplate === 'template3' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(0,0,0,0.3)',
                        color: activeTemplate === 'template3' ? '#38bdf8' : '#e2e8f0', cursor: 'pointer', transition: 'all 0.2s', fontWeight: 600, fontSize: 11
                      }}
                    >
                      <div style={{ fontSize: 20, marginBottom: 4 }}>📰</div>
                      Template 3<br/><span style={{ fontSize: 9, fontWeight: 400 }}>(4-Grid)</span>
                    </button>
                    <button
                      onClick={() => setActiveTemplate('template4')}
                      style={{
                        padding: '12px 8px', borderRadius: 12, border: activeTemplate === 'template4' ? '2px solid #a3e635' : '2px solid rgba(255,255,255,0.1)',
                        background: activeTemplate === 'template4' ? 'rgba(163, 230, 53, 0.15)' : 'rgba(0,0,0,0.3)',
                        color: activeTemplate === 'template4' ? '#a3e635' : '#e2e8f0', cursor: 'pointer', transition: 'all 0.2s', fontWeight: 600, fontSize: 11
                      }}
                    >
                      <div style={{ fontSize: 20, marginBottom: 4 }}>🗞️</div>
                      Template 4<br/><span style={{ fontSize: 9, fontWeight: 400 }}>(News Collage)</span>
                    </button>
                    <button
                      onClick={() => setActiveTemplate('template5')}
                      style={{
                        padding: '12px 8px', borderRadius: 12, border: activeTemplate === 'template5' ? '2px solid #eab308' : '2px solid rgba(255,255,255,0.1)',
                        background: activeTemplate === 'template5' ? 'rgba(234, 179, 8, 0.15)' : 'rgba(0,0,0,0.3)',
                        color: activeTemplate === 'template5' ? '#facc15' : '#e2e8f0', cursor: 'pointer', transition: 'all 0.2s', fontWeight: 600, fontSize: 11
                      }}
                    >
                      <div style={{ fontSize: 20, marginBottom: 4 }}>🔦</div>
                      Template 5<br/><span style={{ fontSize: 9, fontWeight: 400 }}>(Cave Explorer)</span>
                    </button>
                    <button
                      onClick={() => setActiveTemplate('template6')}
                      style={{
                        padding: '12px 8px', borderRadius: 12, border: activeTemplate === 'template6' ? '2px solid #ef4444' : '2px solid rgba(255,255,255,0.1)',
                        background: activeTemplate === 'template6' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(0,0,0,0.3)',
                        color: activeTemplate === 'template6' ? '#f87171' : '#e2e8f0', cursor: 'pointer', transition: 'all 0.2s', fontWeight: 600, fontSize: 11
                      }}
                    >
                      <div style={{ fontSize: 20, marginBottom: 4 }}>🪟</div>
                      Template 6<br/><span style={{ fontSize: 9, fontWeight: 400 }}>(Split Grid)</span>
                    </button>
                    <button
                      onClick={() => setActiveTemplate('template7')}
                      style={{
                        padding: '12px 8px', borderRadius: 12, border: activeTemplate === 'template7' ? '2px solid #3b82f6' : '2px solid rgba(255,255,255,0.1)',
                        background: activeTemplate === 'template7' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(0,0,0,0.3)',
                        color: activeTemplate === 'template7' ? '#60a5fa' : '#e2e8f0', cursor: 'pointer', transition: 'all 0.2s', fontWeight: 600, fontSize: 11
                      }}
                    >
                      <div style={{ fontSize: 20, marginBottom: 4 }}>🧿</div>
                      Template 7<br/><span style={{ fontSize: 9, fontWeight: 400 }}>(Center Focus)</span>
                    </button>
                  </div>
                </div>

                {/* Global Controls */}
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 16, padding: 20, marginBottom: 24 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-block', width: 4, height: 16, background: '#a855f7', borderRadius: 2 }}/>
                    Global Effect (ตั้งค่ารวม)
                  </h3>
                  
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '12px 16px', background: 'rgba(0,0,0,0.3)', borderRadius: 8 }}>
                    <label style={{ color: '#e2e8f0', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={showLayoutLines} onChange={e => setShowLayoutLines(e.target.checked)} style={{ accentColor: '#a855f7', width: 16, height: 16 }} />
                      Show Layout Guidelines (เปิด/ปิดเส้นกั้นรูป)
                    </label>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Fade Mode (รูปแบบการละลายขอบ)</label>
                    <select value={blurMode} onChange={e => setBlurMode(e.target.value)} style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, outline: 'none' }}>
                      <option value="dark">🌙 Dark Vignette (ขอบมืด)</option>
                      <option value="transparent">✨ Seamless Blend (ภาพละลายเข้าหากัน)</option>
                    </select>
                    {blurMode === 'transparent' && (
                      <p style={{ color: '#10b981', fontSize: 11, marginTop: 6 }}>โหมดนี้รูปภาพจะถูกขยายให้ทับซ้อนกันเล็กน้อย เพื่อให้ขอบละลายกลืนกันแบบไร้รอยต่อ</p>
                    )}
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <label style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Global Edge Blur (ความฟุ้งรวม)</label>
                      <span style={{ color: '#fff', fontSize: 12 }}>{globalBlur}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="100" value={globalBlur} 
                      onChange={e => setGlobalBlur(Number(e.target.value))} 
                      style={{ width: '100%', accentColor: '#a855f7', cursor: 'pointer' }} 
                    />
                  </div>
                  
                  <button 
                    onClick={() => {
                      setSlots(prev => prev.map((slot, i) => i === 4 ? slot : { ...slot, fadeDirection: 'radial', edgeFade: 35, overlapSize: 100 }));
                    }}
                    style={{ width: '100%', marginTop: 16, padding: '12px', background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s', boxShadow: '0 4px 15px rgba(139, 92, 246, 0.3)' }}
                  >
                    🪄 Auto Seamless Blend (ผสานภาพอัตโนมัติ)
                  </button>
                </div>
                
                {/* Text Inputs */}
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 16, padding: 20, marginBottom: 24 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-block', width: 4, height: 16, background: '#818cf8', borderRadius: 2 }}/>
                    Typography Overlay
                  </h3>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Text Layout Style</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setTextStyle('draggable')} style={{ flex: 1, padding: '8px', background: textStyle === 'draggable' ? '#334155' : 'transparent', border: textStyle === 'draggable' ? '1px solid #94a3b8' : '1px solid #475569', color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>🕹️ Draggable Box</button>
                      <button onClick={() => setTextStyle('cinematic')} style={{ flex: 1, padding: '8px', background: textStyle === 'cinematic' ? '#991b1b' : 'transparent', border: textStyle === 'cinematic' ? '1px solid #ef4444' : '1px solid #475569', color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>🎬 Cinematic Bottom</button>
                    </div>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Headline 1</label>
                    <input 
                      type="text" value={text1} onChange={e => setText1(e.target.value)} 
                      style={{ width: '100%', padding: '12px 16px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, fontSize: 14, outline: 'none', transition: 'border 0.2s' }} 
                      onFocus={e => e.target.style.border = '1px solid #818cf8'}
                      onBlur={e => e.target.style.border = '1px solid rgba(255,255,255,0.1)'}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Headline 2</label>
                    <input 
                      type="text" value={text2} onChange={e => setText2(e.target.value)} 
                      style={{ width: '100%', padding: '12px 16px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, fontSize: 14, outline: 'none', transition: 'border 0.2s', marginBottom: textStyle === 'cinematic' ? 16 : 20 }} 
                      onFocus={e => e.target.style.border = '1px solid #f472b6'}
                      onBlur={e => e.target.style.border = '1px solid rgba(255,255,255,0.1)'}
                    />
                  </div>
                  {textStyle === 'cinematic' && (
                    <div style={{ marginBottom: 20 }}>
                      <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Headline 3 (แถบแดง)</label>
                      <input 
                        type="text" value={text3} onChange={e => setText3(e.target.value)} placeholder="เช่น รอดำเนินเรื่องเสร็จ..."
                        style={{ width: '100%', padding: '12px 16px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, fontSize: 14, outline: 'none', transition: 'border 0.2s' }} 
                        onFocus={e => e.target.style.border = '1px solid #ef4444'}
                        onBlur={e => e.target.style.border = '1px solid rgba(255,255,255,0.1)'}
                      />
                    </div>
                  )}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <label style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Text Size</label>
                      <span style={{ color: '#fff', fontSize: 12 }}>{textSize}px</span>
                    </div>
                    <input 
                      type="range" min="30" max="150" value={textSize} 
                      onChange={e => setTextSize(Number(e.target.value))} 
                      style={{ width: '100%', accentColor: '#818cf8', cursor: 'pointer' }} 
                    />
                    <p style={{ color: '#64748b', fontSize: 11, marginTop: 8 }}>
                      💡 Tip: คุณสามารถ <b>ใช้เมาส์คลิกค้างแล้วลาก</b> ข้อความในรูปพรีวิวขวาเพื่อขยับตำแหน่งได้เลย!
                    </p>
                  </div>
                </div>

                {/* Image Uploads */}
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 16, padding: 20, marginBottom: 24 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-block', width: 4, height: 16, background: '#f472b6', borderRadius: 2 }}/>
                    Media Assets ({activeTemplate === 'template1' ? 'Template 1' : activeTemplate === 'template2' ? 'Template 2' : activeTemplate === 'template4' ? 'Template 4' : activeTemplate === 'template5' ? 'Template 5' : activeTemplate === 'template6' ? 'Template 6' : activeTemplate === 'template7' ? 'Template 7' : 'Template 3'})
                  </h3>
                  
                  {slotConfig.map((item, idx) => (
                    <div key={idx} style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <span style={{ color: '#cbd5e1', fontSize: 14, fontWeight: 600 }}>{item.icon} {item.label}</span>
                        {slots[idx].image && (
                          <button onClick={() => removeImage(idx)} style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6, transition: 'all 0.2s' }}>
                            Remove
                          </button>
                        )}
                      </div>
                      
                      {!slots[idx].image ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <label
                            onMouseEnter={() => setHoverIdx(idx)}
                            onMouseLeave={() => setHoverIdx(null)}
                            style={{ 
                              display: 'flex', justifyContent: 'center', alignItems: 'center', height: 60, 
                              background: hoverIdx === idx ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255,255,255,0.02)', 
                              border: hoverIdx === idx ? '1px dashed #818cf8' : '1px dashed rgba(255,255,255,0.2)', 
                              borderRadius: 8, cursor: 'pointer', color: '#94a3b8', fontSize: 13, transition: 'all 0.2s'
                            }}
                          >
                            <span style={{ marginRight: 8 }}>+</span> Upload Image (Or assign from AI Pool)
                            <input type="file" accept="image/*" onChange={e => handleFileUpload(idx, e)} style={{ display: 'none' }} />
                          </label>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div style={{ opacity: slots[idx].stretchFit ? 0.5 : 1, pointerEvents: slots[idx].stretchFit ? 'none' : 'auto' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <label style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase' }}>Zoom</label>
                              <span style={{ color: '#94a3b8', fontSize: 11 }}>{slots[idx].zoom.toFixed(2)}x</span>
                            </div>
                            <input 
                              type="range" min={slots[idx].smartFit ? "0.1" : "1"} max="5" step="0.05" value={slots[idx].zoom} 
                              onChange={e => updateSlot(idx, 'zoom', Number(e.target.value))} 
                              style={{ width: '100%', accentColor: '#10b981', height: 4, cursor: 'pointer' }} 
                            />
                          </div>
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <label style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase' }}>Local Edge Blur</label>
                              <span style={{ color: '#94a3b8', fontSize: 11 }}>{slots[idx].blur}%</span>
                            </div>
                            <input 
                              type="range" min="0" max="100" value={slots[idx].blur} 
                              onChange={e => updateSlot(idx, 'blur', Number(e.target.value))} 
                              style={{ width: '100%', accentColor: '#f43f5e', height: 4, cursor: 'pointer' }} 
                            />
                          </div>
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <label style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase' }}>Smooth Blend (ขอบฟุ้งเนียน)</label>
                              <span style={{ color: '#94a3b8', fontSize: 11 }}>{slots[idx].edgeFade || 0}%</span>
                            </div>
                            <input 
                              type="range" min="0" max="100" value={slots[idx].edgeFade || 0} 
                              onChange={e => updateSlot(idx, 'edgeFade', Number(e.target.value))} 
                              style={{ width: '100%', accentColor: '#a855f7', height: 4, cursor: 'pointer' }} 
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                              <select 
                                value={slots[idx].fadeDirection || 'radial'} 
                                onChange={e => updateSlot(idx, 'fadeDirection', e.target.value)}
                                style={{ width: '100%', background: '#1e293b', color: '#f8fafc', border: '1px solid #334155', borderRadius: 4, padding: '4px 8px', fontSize: 11 }}
                              >
                                <option value="radial">🔵 ศูนย์กลาง (Radial)</option>
                                <option value="right">➡️ ฟุ้งขอบขวา (Fade Right)</option>
                                <option value="left">⬅️ ฟุ้งขอบซ้าย (Fade Left)</option>
                                <option value="bottom">⬇️ ฟุ้งขอบล่าง (Fade Bottom)</option>
                                <option value="top">⬆️ ฟุ้งขอบบน (Fade Top)</option>
                              </select>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, marginBottom: 4 }}>
                              <label style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase' }}>Overlap Size (ระยะเกยขอบ)</label>
                              <span style={{ color: '#94a3b8', fontSize: 11 }}>{slots[idx].overlapSize || 0}px</span>
                            </div>
                            <input 
                              type="range" min="0" max="300" value={slots[idx].overlapSize || 0} 
                              onChange={e => updateSlot(idx, 'overlapSize', Number(e.target.value))} 
                              style={{ width: '100%', accentColor: '#38bdf8', height: 4, cursor: 'pointer' }} 
                            />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                            <input type="checkbox" id={`stretchFitToggle-${idx}`} checked={slots[idx].stretchFit} onChange={e => { updateSlot(idx, 'stretchFit', e.target.checked); if(e.target.checked) updateSlot(idx, 'smartFit', false); }} style={{ accentColor: '#eab308', cursor: 'pointer' }} />
                            <label htmlFor={`stretchFitToggle-${idx}`} style={{ color: '#eab308', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>↔️ Stretch Fit (ยืดให้สุดกรอบ)</label>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            <input type="checkbox" id={`smartFitToggle-${idx}`} checked={slots[idx].smartFit} onChange={e => { updateSlot(idx, 'smartFit', e.target.checked); if(e.target.checked) updateSlot(idx, 'stretchFit', false); }} style={{ accentColor: '#6366f1', cursor: 'pointer' }} />
                            <label htmlFor={`smartFitToggle-${idx}`} style={{ color: '#10b981', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>✨ Smart Fit (ลดขนาดไม่ตัดขอบ)</label>
                          </div>
                          {idx === 4 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                              <input type="checkbox" id="centerBorderToggle" checked={centerBorder} onChange={e => setCenterBorder(e.target.checked)} style={{ accentColor: '#f472b6', cursor: 'pointer' }} />
                              <label htmlFor="centerBorderToggle" style={{ color: '#e2e8f0', fontSize: 12, cursor: 'pointer' }}>Show White Border (ปิดเพื่อทำขอบฟุ้ง 100%)</label>
                            </div>
                          )}
                          {/* Optional Yellow Border for Template 2 Slot 2 */}
                          {activeTemplate === 'template2' && idx === 2 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                              <input type="checkbox" id="yellowBorderToggle" checked={showYellowBorder} onChange={e => setShowYellowBorder(e.target.checked)} style={{ accentColor: '#facc15', cursor: 'pointer' }} />
                              <label htmlFor="yellowBorderToggle" style={{ color: '#e2e8f0', fontSize: 12, cursor: 'pointer' }}>Show Yellow Border (ตามตัวอย่าง)</label>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Sticky Export Button Header */}
              <div style={{ padding: '24px', background: 'rgba(15, 15, 20, 0.95)', borderTop: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 -10px 20px rgba(0,0,0,0.5)' }}>
                <button 
                  onClick={exportImage}
                  disabled={isExporting}
                  style={{ 
                    width: '100%', padding: '16px 20px', 
                    background: isExporting ? '#475569' : 'linear-gradient(135deg, #6366f1 0%, #d946ef 100%)', 
                    color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, 
                    cursor: isExporting ? 'wait' : 'pointer', transition: 'all 0.3s',
                    boxShadow: isExporting ? 'none' : '0 10px 25px -5px rgba(99, 102, 241, 0.4)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10
                  }}
                >
                  {isExporting ? '⏳ GENERATING HIGH-RES...' : '🚀 EXPORT DESIGN (1080x1350)'}
                </button>
                <p style={{ textAlign: 'center', color: '#64748b', fontSize: 12, marginTop: 12 }}>
                  * ภาพจะถูกเซฟลงคอมพิวเตอร์ของคุณ
                </p>
              </div>

            </div>

            {/* Right Panel: Live Preview Canvas */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1, background: '#111' }}>
              
              <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center', transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)' }}>
                
                {/* 1080x1350 Canvas Element */}
                <div 
                  ref={coverRef}
                  style={{
                    width: 1080, height: 1350, background: '#000', position: 'relative', overflow: 'hidden', fontFamily: '"Noto Sans Thai", "Inter", sans-serif',
                  }}
                >
                  
                  {activeTemplate === 'template1' ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      {/* Template 1 Grid */}
                      {renderSlot(0, { left: 0, top: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(594/742.5):(540/675))}
                      {renderSlot(1, { right: 0, top: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(594/742.5):(540/675))}
                      {renderSlot(2, { left: 0, bottom: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(594/742.5):(540/675))}
                      {renderSlot(3, { right: 0, bottom: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(594/742.5):(540/675))}
                      
                      {/* Template 1 Layout Lines */}
                      {showLayoutLines && (
                        <>
                          <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2, background: 'rgba(255,255,255,0.5)', transform: 'translateX(-50%)', zIndex: 5, pointerEvents: 'none', borderLeft: '1px solid #000' }} />
                          <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 2, background: 'rgba(255,255,255,0.5)', transform: 'translateY(-50%)', zIndex: 5, pointerEvents: 'none', borderTop: '1px solid #000' }} />
                        </>
                      )}

                      {/* Template 1 Circle (Center) */}
                      {renderCircleSlot({ left: '50%', top: '50%' })}
                    </div>
                  ) : activeTemplate === 'template2' ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      {/* Template 2 Custom Layout */}
                      {renderSlot(0, { left: 0, top: 0, width: blurMode==='transparent'?594:540, height: 1350, zIndex: 1 }, blurMode==='transparent'?(594/1350):(540/1350))}
                      {renderSlot(1, { right: 0, top: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?495:450, zIndex: 1 }, blurMode==='transparent'?(594/495):(540/450))}
                      {renderSlot(2, { right: 0, top: blurMode==='transparent'?405:450, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?540:450, zIndex: 1 }, blurMode==='transparent'?(594/540):(540/450), showYellowBorder)}
                      {renderSlot(3, { right: 0, bottom: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?495:450, zIndex: 1 }, blurMode==='transparent'?(594/495):(540/450))}
                      
                      {/* Template 2 Layout Lines */}
                      {showLayoutLines && (
                        <>
                          <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2, background: 'rgba(255,255,255,0.5)', transform: 'translateX(-50%)', zIndex: 5, pointerEvents: 'none', borderLeft: '1px solid #000' }} />
                          <div style={{ position: 'absolute', right: 0, width: '50%', top: 450, height: 2, background: 'rgba(255,255,255,0.5)', zIndex: 5, pointerEvents: 'none', borderTop: '1px solid #000' }} />
                          <div style={{ position: 'absolute', right: 0, width: '50%', top: 900, height: 2, background: 'rgba(255,255,255,0.5)', zIndex: 5, pointerEvents: 'none', borderTop: '1px solid #000' }} />
                        </>
                      )}

                      {/* Template 2 Circle (Bottom Left intersection) */}
                      {/* Centered at X=540 (middle), Y=900 (intersection of slot 2 and 3) */}
                      {renderCircleSlot({ left: 540, top: 900 })}
                    </div>
                  ) : activeTemplate === 'template3' ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      {/* Template 3 Grid (45/55 Split) */}
                      {renderSlot(0, { left: 0, top: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?668.25:607.5, zIndex: 1 }, blurMode==='transparent'?(594/668.25):(540/607.5))}
                      {renderSlot(1, { right: 0, top: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?668.25:607.5, zIndex: 1 }, blurMode==='transparent'?(594/668.25):(540/607.5))}
                      {renderSlot(2, { left: 0, bottom: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?816.75:742.5, zIndex: 1 }, blurMode==='transparent'?(594/816.75):(540/742.5))}
                      {renderSlot(3, { right: 0, bottom: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?816.75:742.5, zIndex: 1 }, blurMode==='transparent'?(594/816.75):(540/742.5))}
                      
                      {/* Template 3 Layout Lines */}
                      {showLayoutLines && (
                        <>
                          <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2, background: 'rgba(255,255,255,0.5)', transform: 'translateX(-50%)', zIndex: 5, pointerEvents: 'none', borderLeft: '1px solid #000' }} />
                          <div style={{ position: 'absolute', left: 0, right: 0, top: 607.5, height: 2, background: 'rgba(255,255,255,0.5)', transform: 'translateY(-50%)', zIndex: 5, pointerEvents: 'none', borderTop: '1px solid #000' }} />
                        </>
                      )}

                      {/* Template 3 Circle (Center, Smaller, Thinner border) */}
                      {renderCircleSlot({ left: '50%', top: 607.5, width: 380, height: 380, border: '6px solid #fff' })}
                    </div>
                  ) : activeTemplate === 'template4' ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      {/* Base Backgrounds with Gradient Masks */}
                      {renderSlot(0, { left: 0, top: 0, width: blurMode==='transparent'?660:600, height: blurMode==='transparent'?1485:1350, zIndex: 1 }, blurMode==='transparent'?(660/1485):(600/1350))}
                      {renderSlot(1, { right: 0, top: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(594/742.5):(540/675))}
                      {renderSlot(2, { right: 0, bottom: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(594/742.5):(540/675))}
                      
                      {/* Floating Neon Inset */}
                      {renderSlot(3, { right: 20, top: 510, width: 500, height: 330, borderRadius: 8, border: '8px solid #a3e635', boxShadow: '0 10px 30px rgba(0,0,0,0.6)', zIndex: 5 }, 500/330)}
                      
                      {/* Floating Circle Focus */}
                      {renderCircleSlot({ left: 320, top: 1020, width: 450, height: 450, border: '12px solid #fff', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' })}
                    </div>
                  ) : activeTemplate === 'template6' ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      {/* Base Backgrounds with Corner Gradients */}
                      {renderSlot(0, { left: 0, top: 0, width: blurMode==='transparent'?660:600, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(660/742.5):(600/675))}
                      {renderSlot(1, { left: 0, bottom: 0, width: blurMode==='transparent'?660:600, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(660/742.5):(600/675))}
                      {renderSlot(2, { right: 0, top: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(594/742.5):(540/675))}
                      {renderSlot(3, { right: 0, bottom: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(594/742.5):(540/675))}
                      
                      {/* Center Floating Inset (Template 6) - No Circle */}
                      {renderSlot(4, { left: '50%', top: '50%', transform: 'translate(-30%, -50%)', width: 500, height: 330, borderRadius: 8, border: '8px solid #ffff00', boxShadow: '0 10px 30px rgba(0,0,0,0.6)', zIndex: 5 }, 500/330)}
                    </div>
                  ) : activeTemplate === 'template7' ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      {/* Grid Backgrounds with 4 Corner Gradients */}
                      {renderSlot(0, { left: 0, top: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(594/742.5):(540/675))}
                      {renderSlot(1, { right: 0, top: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(594/742.5):(540/675))}
                      {renderSlot(2, { left: 0, bottom: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(594/742.5):(540/675))}
                      {renderSlot(3, { right: 0, bottom: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(594/742.5):(540/675))}
                      
                      {/* Center Circle Focus */}
                      {renderCircleSlot({ left: '50%', top: '50%', width: 380, height: 380, border: '10px solid #fff', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' })}
                    </div>
                  ) : (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      {/* Base Backgrounds with Gradient Masks */}
                      {renderSlot(0, { left: 0, top: 0, width: blurMode==='transparent'?660:600, height: blurMode==='transparent'?1485:1350, zIndex: 1 }, blurMode==='transparent'?(660/1485):(600/1350))}
                      {renderSlot(1, { right: 0, top: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(594/742.5):(540/675))}
                      {renderSlot(2, { right: 0, bottom: 0, width: blurMode==='transparent'?594:540, height: blurMode==='transparent'?742.5:675, zIndex: 1 }, blurMode==='transparent'?(594/742.5):(540/675))}
                      
                      {/* Floating Yellow Inset (Template 5) */}
                      {renderSlot(3, { right: 20, top: 510, width: 500, height: 330, borderRadius: 8, border: '8px solid #ffff00', boxShadow: '0 10px 30px rgba(0,0,0,0.6)', zIndex: 5 }, 500/330)}
                      
                      {/* Floating Circle Focus */}
                      {renderCircleSlot({ left: 320, top: 1020, width: 450, height: 450, border: '12px solid #fff', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' })}
                    </div>
                  )}

                  {/* Typography Overlay */}
                  {textStyle === 'draggable' ? (
                    <div 
                      style={{ 
                        position: 'absolute', top: textPos.y, left: textPos.x, zIndex: 20, 
                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                        cursor: isDragging ? 'grabbing' : 'grab'
                      }}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerUp}
                    >
                      {text1 && (
                        <div style={{
                          background: '#fff', color: '#000', padding: '12px 24px', fontSize: textSize, fontWeight: 700,
                          border: '6px solid #e11d48',
                          lineHeight: 1.2,
                          marginBottom: text2 ? '-6px' : '0'
                        }}>
                          {text1}
                        </div>
                      )}
                      {text2 && (
                        <div style={{
                          background: '#fff', color: '#000', padding: '12px 24px', fontSize: textSize, fontWeight: 700,
                          border: '6px solid #e11d48',
                          lineHeight: 1.2
                        }}>
                          {text2}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ 
                      position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%', zIndex: 20, 
                      background: 'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 25%, rgba(0,0,0,0.5) 50%, transparent 100%)',
                      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', pointerEvents: 'none'
                    }}>
                      {text1 && (
                        <div style={{
                          color: '#fff', fontSize: textSize * 1.3, fontWeight: 800, textAlign: 'center', lineHeight: 1.1, marginBottom: text2 ? 12 : (text3 ? 24 : 40), width: '90%'
                        }}>
                          {text1}
                        </div>
                      )}
                      {text2 && (
                        <div style={{
                          color: '#facc15', fontSize: textSize * 0.9, fontWeight: 700, textAlign: 'center', lineHeight: 1.2, marginBottom: text3 ? 32 : 50, width: '90%'
                        }}>
                          {text2}
                        </div>
                      )}
                      {text3 && (
                        <div style={{
                          background: 'linear-gradient(90deg, rgba(220,38,38,0) 0%, rgba(220,38,38,0.9) 20%, rgba(220,38,38,0.9) 80%, rgba(220,38,38,0) 100%)',
                          width: '100%', padding: '12px 0',
                          color: '#fff', fontSize: textSize * 0.9, fontWeight: 700, textAlign: 'center', lineHeight: 1.2, marginBottom: 20
                        }}>
                          {text3}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </div>
            </div>

            {/* Right Panel: Centralized AI Image Pool */}
            <div style={{ width: 380, background: 'rgba(15, 15, 20, 0.85)', backdropFilter: 'blur(20px)', borderLeft: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
              <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
                  🔍 AI Image Pool
                </h2>
                <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>ค้นหารอบเดียว หยิบใช้ได้ทั้งปกประหยัด API</p>
                
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button onClick={() => setHunterMode('images')} style={{ flex: 1, padding: '8px', background: hunterMode === 'images' ? 'rgba(56, 189, 248, 0.1)' : 'transparent', border: `1px solid ${hunterMode === 'images' ? '#38bdf8' : 'rgba(255,255,255,0.1)'}`, borderRadius: 8, color: hunterMode === 'images' ? '#38bdf8' : '#94a3b8', fontSize: 12, cursor: 'pointer', transition: 'all 0.2s' }}>
                    🖼️ Google Images
                  </button>
                  <button onClick={() => setHunterMode('youtube')} style={{ flex: 1, padding: '8px', background: hunterMode === 'youtube' ? 'rgba(244, 63, 94, 0.1)' : 'transparent', border: `1px solid ${hunterMode === 'youtube' ? '#f43f5e' : 'rgba(255,255,255,0.1)'}`, borderRadius: 8, color: hunterMode === 'youtube' ? '#f43f5e' : '#94a3b8', fontSize: 12, cursor: 'pointer', transition: 'all 0.2s' }}>
                    🎬 YouTube Video
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <input type="text" placeholder="พิมพ์คีย์เวิร์ด (เช่น ถ้ำลาว)" value={hunterQuery} onChange={e => setHunterQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleHuntImages()} style={{ flex: 1, padding: '10px 12px', fontSize: 13, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', outline: 'none' }} />
                  <button onClick={handleHuntImages} disabled={isHunting || !hunterQuery.trim()} style={{ padding: '0 16px', background: isHunting ? '#475569' : '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: isHunting ? 'not-allowed' : 'pointer' }}>
                    {isHunting ? 'กำลังหา...' : '🚀 ค้นหา'}
                  </button>
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                {isHunting ? (
                  <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: 60 }}>
                    <div style={{ fontSize: 48, marginBottom: 16, animation: 'pulse 1.5s infinite' }}>🤖</div>
                    <p style={{ fontSize: 14 }}>กำลังกวาดรูปจากทุกมุมมอง...</p>
                  </div>
                ) : hunterResults.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {hunterResults.map((img, i) => (
                      <div key={i} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <img src={img.url} alt="" style={{ width: '100%', height: 160, objectFit: 'cover' }} />
                        <div style={{ padding: 12 }}>
                          <p style={{ color: '#cbd5e1', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 8 }}>{img.title}</p>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {slotConfig.map((sc, sidx) => (
                              <button key={sidx} onClick={() => updateSlot(sidx, 'image', img.url)} title={`ส่งไป ${sc.label}`} style={{ flex: 1, padding: '6px 0', fontSize: 12, background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: 6, cursor: 'pointer', transition: 'all 0.2s', fontWeight: 600 }}>
                                {sidx === 4 ? 'C' : sidx + 1}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', color: '#475569', marginTop: 60, fontSize: 14 }}>
                    <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>📸</div>
                    ยังไม่มีภาพ พิมพ์คำค้นหาด้านบนได้เลย
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    </ClientLayout>
  );
}
