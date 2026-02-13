import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, Lock } from 'lucide-react';

const PrivacyPolicy: React.FC = () => {
    return (
        <div className="min-h-screen bg-nortex-900 text-slate-300">
            {/* Header */}
            <div className="bg-nortex-800/50 border-b border-slate-700/50 sticky top-0 z-10 backdrop-blur-lg">
                <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
                    <Link to="/" className="text-slate-400 hover:text-white transition-colors">
                        <ArrowLeft size={20} />
                    </Link>
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-nortex-accent rounded-lg flex items-center justify-center">
                            <span className="font-bold text-nortex-900 text-sm">N</span>
                        </div>
                        <span className="font-bold text-white">NORTEX</span>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-4xl mx-auto px-6 py-12">
                <div className="flex items-center gap-3 mb-8">
                    <Shield className="text-nortex-accent" size={28} />
                    <h1 className="text-3xl font-bold text-white">Política de Privacidad</h1>
                </div>
                <p className="text-slate-500 text-sm mb-8">Última actualización: 12 de febrero de 2026</p>

                <div className="space-y-8 leading-relaxed">
                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">1. Introducción</h2>
                        <p>En NORTEX INC. ("nosotros", "la Empresa") nos comprometemos a proteger la privacidad de nuestros usuarios. Esta Política de Privacidad describe cómo recopilamos, usamos, almacenamos y protegemos la información proporcionada a través de nuestra plataforma en <span className="text-nortex-accent">somosnortex.com</span>.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">2. Información que Recopilamos</h2>

                        <h3 className="text-lg font-medium text-slate-200 mt-4 mb-2">2.1 Información de Registro</h3>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>Nombre del negocio y tipo de actividad comercial</li>
                            <li>Correo electrónico del administrador</li>
                            <li>Contraseña (almacenada de forma encriptada con bcrypt)</li>
                            <li>RUC / Cédula jurídica (número de identificación tributaria)</li>
                        </ul>

                        <h3 className="text-lg font-medium text-slate-200 mt-4 mb-2">2.2 Datos Operativos</h3>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>Registros de ventas y transacciones</li>
                            <li>Inventario de productos (nombres, precios, stock)</li>
                            <li>Información de clientes y proveedores</li>
                            <li>Información de empleados (nombres, roles, salarios, INSS)</li>
                            <li>Registros de nómina y contabilidad</li>
                        </ul>

                        <h3 className="text-lg font-medium text-slate-200 mt-4 mb-2">2.3 Datos de Pago</h3>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>Los pagos con tarjeta son procesados por Stripe. NORTEX <strong className="text-white">no almacena</strong> números de tarjeta, CVV ni datos sensibles de pago.</li>
                            <li>Para pagos manuales (transferencia/depósito), almacenamos el número de referencia y monto.</li>
                        </ul>

                        <h3 className="text-lg font-medium text-slate-200 mt-4 mb-2">2.4 Datos Técnicos</h3>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>Dirección IP y tipo de navegador</li>
                            <li>Registros de acceso (logs de autenticación)</li>
                            <li>Métricas de rendimiento del sistema</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">3. Cómo Usamos su Información</h2>
                        <p>Utilizamos la información recopilada para:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Proveer y mantener el funcionamiento del Servicio</li>
                            <li>Procesar transacciones y generar reportes financieros</li>
                            <li>Calcular nóminas conforme a la legislación nicaragüense (Ley 185)</li>
                            <li>Generar reportes fiscales para la DGI</li>
                            <li>Enviar notificaciones relacionadas al Servicio</li>
                            <li>Mejorar la seguridad y prevenir fraudes</li>
                            <li>Brindar soporte técnico</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">4. Almacenamiento y Seguridad</h2>
                        <div className="bg-nortex-800/50 border border-slate-700/50 rounded-xl p-4 mb-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Lock className="text-nortex-accent" size={18} />
                                <span className="text-white font-medium">Medidas de Seguridad Implementadas</span>
                            </div>
                            <ul className="list-disc pl-6 space-y-1 text-sm">
                                <li>Contraseñas encriptadas con bcrypt (hash irreversible)</li>
                                <li>Autenticación mediante JWT (JSON Web Tokens) con expiración</li>
                                <li>Conexiones HTTPS/TLS en toda la plataforma</li>
                                <li>Aislamiento de datos por tenant (multi-tenancy seguro)</li>
                                <li>Rate limiting para prevenir ataques de fuerza bruta</li>
                                <li>Registros de auditoría de acciones sensibles</li>
                            </ul>
                        </div>
                        <p>Los datos se almacenan en servidores seguros. Implementamos medidas técnicas y organizativas diseñadas para proteger la información contra acceso no autorizado, modificación o destrucción.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">5. Compartición de Datos</h2>
                        <p><strong className="text-white">No vendemos, alquilamos ni compartimos su información personal con terceros</strong>, excepto en los siguientes casos:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li><strong className="text-white">Stripe:</strong> Para procesar pagos de suscripción (nombre del negocio, email).</li>
                            <li><strong className="text-white">Obligación legal:</strong> Cuando sea requerido por ley, orden judicial o autoridad competente.</li>
                            <li><strong className="text-white">Protección de derechos:</strong> Para proteger los derechos, seguridad o propiedad de NORTEX o sus usuarios.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">6. Derechos del Usuario</h2>
                        <p>Usted tiene derecho a:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li><strong className="text-white">Acceso:</strong> Solicitar una copia de los datos que tenemos sobre usted.</li>
                            <li><strong className="text-white">Rectificación:</strong> Corregir información inexacta o incompleta.</li>
                            <li><strong className="text-white">Eliminación:</strong> Solicitar la eliminación de su cuenta y datos asociados.</li>
                            <li><strong className="text-white">Portabilidad:</strong> Solicitar la exportación de sus datos en formato estándar.</li>
                            <li><strong className="text-white">Oposición:</strong> Oponerse al procesamiento de sus datos para fines específicos.</li>
                        </ul>
                        <p className="mt-2">Para ejercer estos derechos, contacte a <span className="text-nortex-accent">privacidad@somosnortex.com</span>.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">7. Retención de Datos</h2>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>Los datos se retienen mientras la cuenta esté activa.</li>
                            <li>Tras la cancelación, los datos se conservan 30 días para permitir reactivación.</li>
                            <li>Después de 30 días, los datos se eliminan de forma permanente.</li>
                            <li>Los registros de auditoría pueden conservarse hasta 1 año por razones de seguridad.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">8. Cookies y Almacenamiento Local</h2>
                        <p>NORTEX utiliza almacenamiento local del navegador (localStorage) para:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Mantener su sesión activa (token de autenticación)</li>
                            <li>Almacenar preferencias del usuario</li>
                            <li>Cachear datos temporales para mejorar el rendimiento</li>
                        </ul>
                        <p className="mt-2">No utilizamos cookies de rastreo ni publicidad de terceros.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">9. Menores de Edad</h2>
                        <p>El Servicio no está dirigido a menores de 18 años. No recopilamos deliberadamente información de menores. Si detectamos que un menor ha proporcionado información personal, la eliminaremos de inmediato.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">10. Cambios a esta Política</h2>
                        <p>Podemos actualizar esta Política de Privacidad periódicamente. Los cambios significativos serán notificados a través de la plataforma. La fecha de "última actualización" al inicio de este documento indica la versión vigente.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">11. Contacto</h2>
                        <p>Para consultas sobre privacidad o protección de datos:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Email: <span className="text-nortex-accent">privacidad@somosnortex.com</span></li>
                            <li>Web: <span className="text-nortex-accent">https://somosnortex.com</span></li>
                        </ul>
                    </section>
                </div>

                {/* Footer Links */}
                <div className="mt-12 pt-8 border-t border-slate-700/50 flex flex-wrap gap-6 text-sm">
                    <Link to="/terms" className="text-nortex-accent hover:underline">Términos de Servicio</Link>
                    <Link to="/" className="text-slate-500 hover:text-white transition-colors">Volver al inicio</Link>
                </div>
            </div>
        </div>
    );
};

export default PrivacyPolicy;
