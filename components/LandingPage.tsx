import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    ArrowRight, CheckCircle, Users, Calculator, ScanBarcode,
    Building2, XCircle, Zap, Building, Clock, Shield, TrendingUp,
    Package, BarChart3, FileText, Smartphone
} from 'lucide-react';

const LandingPage: React.FC = () => {
    const { niche } = useParams<{ niche: string }>();
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 30);
        window.addEventListener('scroll', onScroll);
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Determine niche content
    const n = niche?.toLowerCase() || '';
    let badge = '🇳🇮 Hecho en Nicaragua';
    let headline = 'No uses Excel. No uses libretas. Usa el sistema de los negocios que';
    let focusWord = 'sí están creciendo.';
    let subtitle = 'Nortex es el Punto de Venta, Control de Inventario y Cierre Fiscal (DGI) más fácil de Nicaragua.';

    if (n === 'ferreterias') {
        badge = '🔩 Para Ferreterías';
        headline = 'El Sistema Exacto para tu';
        focusWord = 'Ferretería.';
        subtitle = 'Controla miles de códigos, vende al contado y crédito, y genera reportes DGI. De Managua a Estelí.';
    } else if (n === 'farmacias') {
        badge = '💊 Para Farmacias';
        headline = 'Control de Lotes y Vencimientos para';
        focusWord = 'Farmacias.';
        subtitle = 'El único POS que alerta vencimientos, controla lotes y automatiza tu facturación DGI.';
    } else if (n === 'contabilidad-dgi') {
        badge = '📊 Contabilidad DGI';
        headline = 'Retenciones 2% y 1% en Piloto Automático.';
        focusWord = 'Facturación DGI.';
        subtitle = 'Deja de calcular impuestos a mano. Nortex deduce IVA, IR e IMI automáticamente.';
    }

    return (
        <div style={{ minHeight: '100vh', background: '#050A12', color: '#fff', fontFamily: 'Inter, sans-serif' }}>

            {/* === NAVBAR === */}
            <nav style={{
                position: 'fixed', top: 0, width: '100%', zIndex: 50,
                background: scrolled ? 'rgba(5,10,18,0.85)' : 'transparent',
                backdropFilter: scrolled ? 'blur(20px)' : 'none',
                borderBottom: scrolled ? '1px solid rgba(255,255,255,0.05)' : 'none',
                padding: scrolled ? '12px 0' : '20px 0',
                transition: 'all 0.4s ease'
            }}>
                <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: 'linear-gradient(135deg, #3B82F6, #10B981)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 4px 20px rgba(59,130,246,0.3)'
                        }}>
                            <span style={{ fontWeight: 900, fontSize: 18, color: '#fff' }}>N</span>
                        </div>
                        <span style={{ fontWeight: 900, fontSize: 20, letterSpacing: '-0.5px' }}>NORTEX</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Link to="/login" style={{ color: '#94A3B8', fontWeight: 600, fontSize: 14, textDecoration: 'none', padding: '8px 16px' }}>
                            Ingresar
                        </Link>
                        <Link to="/register" style={{
                            background: '#fff', color: '#0F172A', fontWeight: 700, fontSize: 14,
                            padding: '10px 22px', borderRadius: 999, textDecoration: 'none',
                            boxShadow: '0 4px 20px rgba(255,255,255,0.1)'
                        }}>
                            Crear Cuenta Gratis
                        </Link>
                    </div>
                </div>
            </nav>

            {/* === HERO === */}
            <section style={{ position: 'relative', paddingTop: 140, paddingBottom: 80, overflow: 'hidden' }}>
                {/* Ambient Glow */}
                <div style={{
                    position: 'absolute', top: -100, left: '50%', transform: 'translateX(-50%)',
                    width: 800, height: 500, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)',
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute', top: 100, right: -200,
                    width: 500, height: 500, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)',
                    pointerEvents: 'none'
                }} />

                <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px', textAlign: 'center', position: 'relative' }}>
                    {/* Badge */}
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 999, padding: '6px 16px', fontSize: 14, fontWeight: 600,
                        color: '#CBD5E1', marginBottom: 32, backdropFilter: 'blur(10px)'
                    }}>
                        {badge}
                    </div>

                    {/* H1 */}
                    <h1 style={{ fontSize: 'clamp(2.2rem, 6vw, 4.2rem)', fontWeight: 900, lineHeight: 1.1, letterSpacing: '-2px', marginBottom: 20 }}>
                        {headline}{' '}
                        <span style={{
                            background: 'linear-gradient(135deg, #60A5FA, #34D399)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text'
                        }}>
                            {focusWord}
                        </span>
                    </h1>

                    {/* Subtitle */}
                    <p style={{ fontSize: 'clamp(1rem, 2.5vw, 1.25rem)', color: '#94A3B8', maxWidth: 600, margin: '0 auto 40px', lineHeight: 1.7, fontWeight: 500 }}>
                        {subtitle}
                    </p>

                    {/* CTA */}
                    <Link to="/register" style={{
                        display: 'inline-flex', alignItems: 'center', gap: 10,
                        background: 'linear-gradient(135deg, #3B82F6, #10B981)',
                        color: '#fff', fontWeight: 700, fontSize: 18,
                        padding: '16px 36px', borderRadius: 999, textDecoration: 'none',
                        boxShadow: '0 8px 40px rgba(59,130,246,0.35)',
                        transition: 'transform 0.2s, box-shadow 0.2s'
                    }}
                        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 50px rgba(59,130,246,0.5)'; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 8px 40px rgba(59,130,246,0.35)'; }}
                    >
                        Empieza Gratis en 2 Minutos <ArrowRight size={20} />
                    </Link>

                    <p style={{ color: '#64748B', fontSize: 13, marginTop: 16, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <CheckCircle size={14} color="#10B981" /> Sin tarjeta de crédito · Configuración en 3 clics
                    </p>

                    {/* Social Proof */}
                    <div style={{ marginTop: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                        <div style={{ display: 'flex' }}>
                            {['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B'].map((c, i) => (
                                <div key={i} style={{
                                    width: 36, height: 36, borderRadius: '50%', background: c,
                                    border: '2px solid #050A12', marginLeft: i > 0 ? -8 : 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 11, fontWeight: 700
                                }}>
                                    {i === 3 && '+'}
                                </div>
                            ))}
                        </div>
                        <div style={{ textAlign: 'left' }}>
                            <p style={{ fontSize: 13, fontWeight: 700 }}>+150 negocios en Nicaragua</p>
                            <p style={{ fontSize: 11, color: '#64748B' }}>Procesando más de C$10M mensuales</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* === TRUST BAR === */}
            <section style={{ borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '24px 0' }}>
                <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '24px 48px' }}>
                    {[
                        { icon: <Shield size={16} color="#10B981" />, text: 'Cifrado AES-256' },
                        { icon: <TrendingUp size={16} color="#10B981" />, text: '99.9% Uptime' },
                        { icon: <Smartphone size={16} color="#10B981" />, text: 'Cualquier Dispositivo' },
                        { icon: <FileText size={16} color="#10B981" />, text: 'Cumple DGI' },
                    ].map((item, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#64748B' }}>
                            {item.icon} {item.text}
                        </div>
                    ))}
                </div>
            </section>

            {/* === DOLOR VS SOLUCIÓN === */}
            <section id="dolor" style={{ padding: '80px 0' }}>
                <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px' }}>
                    <div style={{ textAlign: 'center', marginBottom: 48 }}>
                        <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, letterSpacing: '-1px', marginBottom: 12 }}>
                            Sobrevivir vs.{' '}
                            <span style={{ background: 'linear-gradient(135deg, #34D399, #22D3EE)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                                Crecer de Verdad
                            </span>
                        </h2>
                        <p style={{ color: '#94A3B8', fontSize: 17, fontWeight: 500 }}>Tu negocio merece tecnología que trabaje para ti.</p>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
                        {/* Pain */}
                        <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)', borderRadius: 20, padding: 32 }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,0.1)', color: '#F87171', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', borderRadius: 8, padding: '5px 12px', marginBottom: 24 }}>
                                <XCircle size={13} /> La Pesadilla
                            </div>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                {[
                                    'Cuadres de caja que nunca dan, faltando C$200 diario.',
                                    'Pánico calculando IVA y Retenciones a mano.',
                                    'Robos hormiga de inventario imposibles de detectar.',
                                    'Horas perdidas calculando INSS y liquidaciones.',
                                ].map((t, i) => (
                                    <li key={i} style={{ display: 'flex', gap: 10, marginBottom: 16, color: '#CBD5E1', fontWeight: 500, fontSize: 15 }}>
                                        <XCircle size={17} color="#EF4444" style={{ flexShrink: 0, marginTop: 3 }} />
                                        <span>{t}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Solution */}
                        <div style={{
                            background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.12)',
                            borderRadius: 20, padding: 32,
                            boxShadow: '0 8px 40px rgba(16,185,129,0.06)'
                        }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(16,185,129,0.1)', color: '#34D399', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', borderRadius: 8, padding: '5px 12px', marginBottom: 24 }}>
                                <CheckCircle size={13} /> Con Nortex
                            </div>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                {[
                                    'Cierres de turno ciegos, automatizados en segundos.',
                                    'Reportes DGI y Retenciones a un clic.',
                                    'Auditoría forense detectando ajustes sospechosos.',
                                    'Nómina y Aguinaldo en piloto automático.',
                                ].map((t, i) => (
                                    <li key={i} style={{ display: 'flex', gap: 10, marginBottom: 16, color: '#fff', fontWeight: 500, fontSize: 15 }}>
                                        <CheckCircle size={17} color="#10B981" style={{ flexShrink: 0, marginTop: 3 }} />
                                        <span>{t}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </section>

            {/* === FEATURES === */}
            <section style={{ padding: '80px 0', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px' }}>
                    <div style={{ textAlign: 'center', marginBottom: 48 }}>
                        <h2 style={{ fontSize: 'clamp(1.6rem, 3.5vw, 2.2rem)', fontWeight: 900, letterSpacing: '-0.5px', marginBottom: 8 }}>Un Solo Sistema. Todo el Control.</h2>
                        <p style={{ color: '#94A3B8', fontSize: 16, fontWeight: 500 }}>Sustituye 5 apps desconectadas por un motor central.</p>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                        {[
                            { icon: <ScanBarcode size={22} />, title: 'Punto de Venta', desc: 'Vende en segundos. Código de barras, descuentos, crédito.', color: '#3B82F6' },
                            { icon: <Package size={22} />, title: 'Inventario & Kardex', desc: 'Stock exacto, alertas de agotamiento, auditoría forense.', color: '#10B981' },
                            { icon: <Users size={22} />, title: 'RRHH & NicaLabor', desc: 'Nómina Ley 185, aguinaldos, liquidaciones automáticas.', color: '#8B5CF6' },
                            { icon: <Calculator size={22} />, title: 'DGI Automático', desc: 'Retenciones IR 2%, IMI 1%, IVA deducido por factura.', color: '#06B6D4' },
                            { icon: <BarChart3 size={22} />, title: 'Salud Financiera', desc: 'Balance General, P&L, Nortex Score de tu negocio.', color: '#F59E0B' },
                            { icon: <Building2 size={22} />, title: 'Mercado B2B', desc: 'Conecta con proveedores mayoristas directamente.', color: '#EC4899' },
                        ].map((f, i) => (
                            <div key={i} style={{
                                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                                borderRadius: 16, padding: 24, transition: 'all 0.3s ease', cursor: 'default'
                            }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
                            >
                                <div style={{
                                    width: 44, height: 44, borderRadius: 12,
                                    background: `${f.color}15`, color: f.color,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    marginBottom: 16
                                }}>
                                    {f.icon}
                                </div>
                                <h3 style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{f.title}</h3>
                                <p style={{ color: '#94A3B8', fontSize: 14, fontWeight: 500, lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* === NORTEX BOOST === */}
            <section id="boost" style={{ padding: '80px 0', position: 'relative', overflow: 'hidden' }}>
                <div style={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                    width: 600, height: 600, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)',
                    pointerEvents: 'none'
                }} />

                <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px', textAlign: 'center', position: 'relative' }}>
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)',
                        color: '#FBBF24', fontSize: 13, fontWeight: 700, borderRadius: 999, padding: '6px 16px', marginBottom: 32
                    }}>
                        <Zap size={14} style={{ fill: '#FBBF24' }} /> NORTEX BOOST
                    </div>

                    <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, letterSpacing: '-1px', marginBottom: 20 }}>
                        Tu data de ventas vale oro.{' '}
                        <span style={{ background: 'linear-gradient(135deg, #FBBF24, #F97316)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                            Literalmente.
                        </span>
                    </h2>

                    <p style={{ fontSize: 17, color: '#CBD5E1', maxWidth: 650, margin: '0 auto 40px', lineHeight: 1.7, fontWeight: 500 }}>
                        ¿Necesitas llenar tus tramos para diciembre? El sistema analiza tus ventas y te ofrece{' '}
                        <strong style={{ color: '#fff' }}>adelantos de capital al instante.</strong>{' '}
                        Sin bancos, sin fiadores, sin papeleos.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 40 }}>
                        {[
                            { icon: <Building size={20} />, title: 'Sin Bancos', desc: 'No pedimos estados financieros sellados.' },
                            { icon: <Users size={20} />, title: 'Sin Fiadores', desc: 'Tus ventas en Nortex son tu garantía.' },
                            { icon: <Clock size={20} />, title: 'Al Instante', desc: 'Crédito pre-aprobado en 24 horas.' },
                        ].map((f, i) => (
                            <div key={i} style={{
                                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                                borderRadius: 16, padding: 20, textAlign: 'left'
                            }}>
                                <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(245,158,11,0.1)', color: '#FBBF24', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                                    {f.icon}
                                </div>
                                <h4 style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, margin: '0 0 4px 0' }}>{f.title}</h4>
                                <p style={{ color: '#94A3B8', fontSize: 13, fontWeight: 500, margin: 0, lineHeight: 1.5 }}>{f.desc}</p>
                            </div>
                        ))}
                    </div>

                    <div style={{
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(245,158,11,0.2)',
                        borderRadius: 20, padding: 32, display: 'inline-block'
                    }}>
                        <p style={{ color: '#94A3B8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, margin: '0 0 8px 0' }}>Línea de Crédito Hasta</p>
                        <p style={{
                            fontSize: 'clamp(2.5rem, 5vw, 3.5rem)', fontWeight: 900, margin: 0,
                            background: 'linear-gradient(135deg, #FBBF24, #F97316)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
                        }}>
                            C$ 150,000
                        </p>
                        <p style={{ color: '#64748B', fontSize: 11, marginTop: 8, margin: '8px 0 0 0' }}>*Para negocios con Nortex Pro activo 3+ meses.</p>
                    </div>
                </div>
            </section>

            {/* === PRICING === */}
            <section id="precio" style={{ padding: '80px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px' }}>
                    <div style={{ textAlign: 'center', marginBottom: 48 }}>
                        <h2 style={{ fontSize: 'clamp(1.6rem, 3.5vw, 2.2rem)', fontWeight: 900, letterSpacing: '-0.5px', marginBottom: 8 }}>Precios Honestos.</h2>
                        <p style={{ color: '#94A3B8', fontSize: 16, fontWeight: 500 }}>Diseñado para que crezcas, no para exprimirte.</p>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
                        {/* Free */}
                        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 20, padding: 32, display: 'flex', flexDirection: 'column' }}>
                            <h3 style={{ fontWeight: 900, fontSize: 20, marginBottom: 4 }}>Comienza Hoy</h3>
                            <p style={{ color: '#64748B', fontSize: 14, fontWeight: 500, marginBottom: 20 }}>Probá el sistema en tu tienda real.</p>
                            <div style={{ marginBottom: 24 }}>
                                <span style={{ fontSize: 48, fontWeight: 900 }}>$0</span>
                                <span style={{ color: '#64748B', fontWeight: 600, marginLeft: 4 }}>/prueba</span>
                            </div>
                            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px 0', flex: 1 }}>
                                {['POS Web completo', 'Inventario básico', 'Hasta 50 productos', '14 días gratis'].map((t, i) => (
                                    <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14, color: '#CBD5E1', fontWeight: 500 }}>
                                        <CheckCircle size={15} color="#64748B" /> {t}
                                    </li>
                                ))}
                            </ul>
                            <Link to="/register" style={{
                                display: 'block', textAlign: 'center', padding: '12px 20px',
                                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 12, color: '#fff', fontWeight: 700, textDecoration: 'none', fontSize: 14
                            }}>
                                Instalar Gratis
                            </Link>
                        </div>

                        {/* Pro */}
                        <div style={{
                            background: 'linear-gradient(180deg, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0) 100%)',
                            border: '1px solid rgba(59,130,246,0.2)', borderRadius: 20, padding: 32,
                            display: 'flex', flexDirection: 'column', position: 'relative',
                            boxShadow: '0 8px 40px rgba(59,130,246,0.1)'
                        }}>
                            <div style={{
                                position: 'absolute', top: 0, right: 24, transform: 'translateY(-50%)',
                                background: 'linear-gradient(135deg, #3B82F6, #06B6D4)', color: '#fff',
                                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                                padding: '4px 12px', borderRadius: 999
                            }}>
                                Popular
                            </div>
                            <h3 style={{ fontWeight: 900, fontSize: 20, marginBottom: 4 }}>Nortex Pro</h3>
                            <p style={{ color: '#94A3B8', fontSize: 14, fontWeight: 500, marginBottom: 20 }}>Todo el arsenal. Sin límites.</p>
                            <div style={{ marginBottom: 24 }}>
                                <span style={{ fontSize: 48, fontWeight: 900 }}>$25</span>
                                <span style={{ color: '#64748B', fontWeight: 600, marginLeft: 4 }}>/mes</span>
                            </div>
                            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px 0', flex: 1 }}>
                                {['Usuarios y productos ilimitados', 'Auditoría Forense + Dashboard', 'NicaLabor (Nómina y Aguinaldo)', 'Retenciones DGI automáticas', 'Elegible para Nortex Boost'].map((t, i) => (
                                    <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14, color: '#fff', fontWeight: 600 }}>
                                        <CheckCircle size={15} color="#3B82F6" /> {t}
                                    </li>
                                ))}
                            </ul>
                            <Link to="/register" style={{
                                display: 'block', textAlign: 'center', padding: '12px 20px',
                                background: 'linear-gradient(135deg, #3B82F6, #06B6D4)', borderRadius: 12,
                                color: '#fff', fontWeight: 700, textDecoration: 'none', fontSize: 14,
                                boxShadow: '0 4px 20px rgba(59,130,246,0.3)'
                            }}>
                                Crear Cuenta Pro
                            </Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* === FOOTER === */}
            <footer style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '32px 0' }}>
                <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #3B82F6, #10B981)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ fontWeight: 900, fontSize: 14, color: '#fff' }}>N</span>
                        </div>
                        <span style={{ fontWeight: 900, fontSize: 14 }}>NORTEX</span>
                    </div>
                    <p style={{ color: '#475569', fontSize: 12, fontWeight: 500, margin: 0 }}>© {new Date().getFullYear()} Nortex Technology · Managua, Nicaragua</p>
                    <div style={{ display: 'flex', gap: 20 }}>
                        <Link to="/login" style={{ color: '#64748B', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Login</Link>
                        <Link to="/terms" style={{ color: '#64748B', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Términos</Link>
                        <Link to="/privacy" style={{ color: '#64748B', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Privacidad</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
