import React from 'react';
import { Shield, Lock } from 'lucide-react';
import BlogShell from './blog/BlogShell';

export const PrivacyPolicyContent: React.FC = () => (
            <article aria-labelledby="privacy-title">
                <header className="mb-10">
                    <p className="nx-public-badge mb-5 gap-2">
                        <Shield aria-hidden="true" size={17} />
                        Privacidad y seguridad
                    </p>
                    <h1 id="privacy-title" className="max-w-3xl text-4xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-5xl">
                        Política de Privacidad
                    </h1>
                    <p className="nx-public-subtle mt-4 text-sm">Última actualización: 12 de febrero de 2026</p>
                </header>

                <div className="nx-public-reading space-y-9">
                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">1. Introducción</h2>
                        <p>En NORTEX INC. ("nosotros", "la Empresa") nos comprometemos a proteger la privacidad de nuestros usuarios. Esta Política de Privacidad describe cómo recopilamos, usamos, almacenamos y protegemos la información proporcionada a través de nuestra plataforma en <span className="nx-prose-strong">somosnortex.com</span>.</p>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">2. Información que Recopilamos</h2>

                        <h3 className="nx-prose-heading mb-2 mt-4 text-lg">2.1 Información de Registro</h3>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>Nombre del negocio y tipo de actividad comercial</li>
                            <li>Correo electrónico del administrador</li>
                            <li>Contraseña (almacenada de forma encriptada con bcrypt)</li>
                            <li>RUC / Cédula jurídica (número de identificación tributaria)</li>
                        </ul>

                        <h3 className="nx-prose-heading mb-2 mt-4 text-lg">2.2 Datos Operativos</h3>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>Registros de ventas y transacciones</li>
                            <li>Inventario de productos (nombres, precios, stock)</li>
                            <li>Información de clientes y proveedores</li>
                            <li>Información de empleados (nombres, roles, salarios, INSS)</li>
                            <li>Registros de nómina y contabilidad</li>
                        </ul>

                        <h3 className="nx-prose-heading mb-2 mt-4 text-lg">2.3 Datos de Pago</h3>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>Los pagos con tarjeta son procesados por Stripe. NORTEX <strong className="nx-prose-strong">no almacena</strong> números de tarjeta, CVV ni datos sensibles de pago.</li>
                            <li>Para pagos manuales (transferencia/depósito), almacenamos el número de referencia y monto.</li>
                        </ul>

                        <h3 className="nx-prose-heading mb-2 mt-4 text-lg">2.4 Datos Técnicos</h3>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>Dirección IP y tipo de navegador</li>
                            <li>Registros de acceso (logs de autenticación)</li>
                            <li>Métricas de rendimiento del sistema</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">3. Cómo Usamos su Información</h2>
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
                        <h2 className="nx-prose-heading mb-3 text-xl">4. Almacenamiento y Seguridad</h2>
                        <div className="nx-public-surface mb-4 rounded-2xl border p-5">
                            <div className="flex items-center gap-2 mb-2">
                                <Lock className="nx-public-subtle" aria-hidden="true" size={18} />
                                <span className="nx-prose-strong">Medidas de Seguridad Implementadas</span>
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
                        <h2 className="nx-prose-heading mb-3 text-xl">5. Compartición de Datos</h2>
                        <p><strong className="nx-prose-strong">No vendemos, alquilamos ni compartimos su información personal con terceros</strong>, excepto en los siguientes casos:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li><strong className="nx-prose-strong">Stripe:</strong> Para procesar pagos de suscripción (nombre del negocio, email).</li>
                            <li><strong className="nx-prose-strong">Obligación legal:</strong> Cuando sea requerido por ley, orden judicial o autoridad competente.</li>
                            <li><strong className="nx-prose-strong">Protección de derechos:</strong> Para proteger los derechos, seguridad o propiedad de NORTEX o sus usuarios.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">6. Derechos del Usuario</h2>
                        <p>Usted tiene derecho a:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li><strong className="nx-prose-strong">Acceso:</strong> Solicitar una copia de los datos que tenemos sobre usted.</li>
                            <li><strong className="nx-prose-strong">Rectificación:</strong> Corregir información inexacta o incompleta.</li>
                            <li><strong className="nx-prose-strong">Eliminación:</strong> Solicitar la eliminación de su cuenta y datos asociados.</li>
                            <li><strong className="nx-prose-strong">Portabilidad:</strong> Solicitar la exportación de sus datos en formato estándar.</li>
                            <li><strong className="nx-prose-strong">Oposición:</strong> Oponerse al procesamiento de sus datos para fines específicos.</li>
                        </ul>
                        <p className="mt-2">Para ejercer estos derechos, contacte a <span className="nx-prose-strong">privacidad@somosnortex.com</span>.</p>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">7. Retención de Datos</h2>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>Los datos se retienen mientras la cuenta esté activa.</li>
                            <li>Tras la cancelación, los datos se conservan 30 días para permitir reactivación.</li>
                            <li>Después de 30 días, los datos se eliminan de forma permanente.</li>
                            <li>Los registros de auditoría pueden conservarse hasta 1 año por razones de seguridad.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">8. Cookies y Almacenamiento Local</h2>
                        <p>NORTEX utiliza almacenamiento local del navegador (localStorage) para:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Mantener su sesión activa (token de autenticación)</li>
                            <li>Almacenar preferencias del usuario</li>
                            <li>Cachear datos temporales para mejorar el rendimiento</li>
                        </ul>
                        <p className="mt-2">
                            Usamos <strong>Google Analytics 4</strong> para entender de forma agregada
                            cómo se usa el sitio (páginas visitadas, registros, inicios de prueba) y así
                            mejorar el producto. Google Analytics coloca cookies propias (p. ej. <code>_ga</code>)
                            con la <strong>dirección IP anonimizada</strong>; los datos se usan solo con fines
                            estadísticos y de medición. No activamos cookies de publicidad ni compartimos tus
                            datos con terceros para fines publicitarios (Consent Mode con almacenamiento de
                            anuncios deshabilitado).
                        </p>
                        <p className="mt-2">
                            Podés desactivar Google Analytics con el{' '}
                            <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer" className="nx-public-link">complemento de inhabilitación de Google</a>{' '}
                            o bloqueando cookies desde tu navegador.
                        </p>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">9. Menores de Edad</h2>
                        <p>El Servicio no está dirigido a menores de 18 años. No recopilamos deliberadamente información de menores. Si detectamos que un menor ha proporcionado información personal, la eliminaremos de inmediato.</p>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">10. Cambios a esta Política</h2>
                        <p>Podemos actualizar esta Política de Privacidad periódicamente. Los cambios significativos serán notificados a través de la plataforma. La fecha de "última actualización" al inicio de este documento indica la versión vigente.</p>
                    </section>

                    <section>
                        <h2 className="nx-prose-heading mb-3 text-xl">11. Contacto</h2>
                        <p>Para consultas sobre privacidad o protección de datos:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Email: <span className="nx-prose-strong">privacidad@somosnortex.com</span></li>
                            <li>Web: <span className="nx-prose-strong">https://somosnortex.com</span></li>
                        </ul>
                    </section>
                </div>
            </article>
);

const PrivacyPolicy: React.FC = () => {
    return (
        <BlogShell
            width="reading"
            eyebrow="Legal"
            contentId="privacy-main-content"
            actions={[]}
            footerLinks={[{ to: '/', label: 'Volver al inicio' }]}
        >
            <PrivacyPolicyContent />
        </BlogShell>
    );
};

export default PrivacyPolicy;
